import BizError from '../error/biz-error';
import KvConst from '../const/kv-const';
import orm from '../entity/orm';
import account from '../entity/account';
import { eq } from 'drizzle-orm';
import accountService from './account-service';
import userService from './user-service';

// ============================================================================
// PATCH（新增文件）：邮箱有效期 —— 服务器端存储
// ----------------------------------------------------------------------------
// 背景：account 表（D1，见 src/entity/account.js）没有过期字段，有效期以前只存在
// temp 前端的 localStorage（key temp-expiry-v1）里，换个浏览器就读不到，定时邮箱
// 会显示成永久保留、到期也不会删。本文件把有效期表搬到 Worker 自带的 KV 里，
// 任何浏览器登录后看到的都一样；再加一个定时清扫，到期自动彻底删除。
//
// 存储格式：KV key 见 kv-const.js 新增的 MAILBOX_EXPIRY，值是 JSON 对象，
// accountId（转成字符串）-> 一条记录，例如：
//   {"12": {"email": "x@daju123.xyz", "retention": "86400000",
//           "expiresAt": 1793123456789, "createdAt": 1793037056789, "userId": 3}}
//   - retention：前端 RET_OPTIONS 里的毫秒数字符串（"86400000"=24小时，
//     "259200000"=3天，"604800000"=7天，"2592000000"=30天）；
//     永久保留的邮箱不在表里存记录（没有记录 = 永久），表只存定时邮箱。
//   - userId：记录归属。KV 里整张表是全站共用的，读接口只返回调用者自己的记录，
//     写接口先校验账号归属，绝不跨用户读写（见 getMyExpiries / setExpiry）。
//
// 调用约定：本文件只用 c.env（orm(c) 只读 c.env.db），所以在 Hono 路由里能用，
// 在 scheduled 定时任务里拿 { env } 当 c 传进来也能用——和 verifyRecordService
// .clearRecord({ env })、userService.resetDaySendCount({ env }) 的用法一样。
// 本文件 import account-service / user-service；它俩不 import 本文件，无循环引用。
// 删邮箱时清过期记录的钩子不在这里，见 patches/account-api.patch（放 api 层，
// 避免 account-service 反向 import 本文件）。
// ============================================================================

// 前端 RET_OPTIONS 里允许的保留时长（毫秒字符串），与 temp-frontend/index.html 保持一致
const ALLOWED_RETENTIONS = ['86400000', '259200000', '604800000', '2592000000'];

// 单张 KV 表里的记录数上限（防滥用；正常用一个账号的邮箱数远小于这个数）
const MAX_ENTRIES = 500;

// 每次定时清扫最多处理几个过期邮箱：Free 计划每次定时调用最多 50 个子请求
// （KV / D1 / R2 调用都算），一个过期邮箱彻底删除约 6–8 个子请求；
// 超出的留到下一次（每小时）再清，不会丢。
const MAX_SWEEP_PER_RUN = 5;

const expiryService = {

	// —— 读整张过期表。任何失败（KV 未绑定、值损坏、格式不对）都返回 {} ——
	// 调用方退回“没有任何过期记录”的行为，绝不影响登录、建邮箱、收信、列邮箱。
	async loadMap(c) {
		try {
			const raw = await c.env.kv.get(KvConst.MAILBOX_EXPIRY);
			if (!raw) return {};
			const map = JSON.parse(raw);
			if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
			// 只保留形状正确的记录，脏数据直接丢掉（不让一条坏记录毒死整张表）
			const clean = {};
			for (const key of Object.keys(map)) {
				const e = map[key];
				if (e && typeof e === 'object'
					&& typeof e.expiresAt === 'number'
					&& typeof e.userId === 'number'
					&& typeof e.email === 'string') {
					clean[key] = e;
				}
			}
			return clean;
		} catch (err) {
			console.error('[expiry-service] 读取 KV 过期表失败，已退回空表：', err);
			return {};
		}
	},

	async saveMap(c, map) {
		await c.env.kv.put(KvConst.MAILBOX_EXPIRY, JSON.stringify(map));
	},

	// —— 供 GET /account/expiry：只返回调用者自己的定时记录，按到期时间排序 ——
	// 永久保留的邮箱不在表里，不会出现在这里。
	async getMyExpiries(c, userId) {
		const map = await this.loadMap(c);
		const list = [];
		for (const key of Object.keys(map)) {
			const e = map[key];
			if (!e || e.userId !== userId || !e.expiresAt) continue;
			list.push({
				accountId: Number(key),
				email: e.email,
				retention: e.retention,
				expiresAt: e.expiresAt,
				createdAt: e.createdAt,
			});
		}
		return list.sort((a, b) => a.expiresAt - b.expiresAt);
	},

	// —— 供 POST /account/expiry：给自己的一个邮箱设置 / 更改 / 清除有效期 ——
	// 入参 { accountId, retention }，retention 为 '' / 'permanent' / null 时清除记录
	// （变回永久保留），否则必须是 ALLOWED_RETENTIONS 里的毫秒数字符串。
	// 校验顺序：账号存在 -> 账号归调用者所有 -> 不是主邮箱（登录账号本身）。
	async setExpiry(c, params, userId) {
		const accountId = Number(params && params.accountId);
		if (!accountId || Number.isNaN(accountId)) {
			throw new BizError('缺少 accountId');
		}
		// selectById 只返回未删除的账号（见 account-service.js）
		const accountRow = await accountService.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError('邮箱不存在或已被删除');
		}
		if (accountRow.userId !== userId) {
			throw new BizError('无权操作该邮箱', 403);
		}
		// 主邮箱（登录账号本身）绝不能设有效期：删掉它等于删登录账号，
		// account-service.delete() 里对主邮箱也是同样禁止的（delMyAccount）。
		const userRow = await userService.selectById(c, userId);
		if (userRow && accountRow.email === userRow.email) {
			throw new BizError('主邮箱（登录账号）不能设置有效期');
		}

		const retention = params.retention == null ? '' : String(params.retention).trim();
		const map = await this.loadMap(c);
		const key = String(accountId);

		if (retention === '' || retention === 'permanent') {
			if (map[key]) {
				delete map[key];
				await this.saveMap(c, map);
			}
			return null;
		}
		if (!ALLOWED_RETENTIONS.includes(retention)) {
			throw new BizError('保留期限不正确，只能选 24小时 / 3天 / 7天 / 30天');
		}
		if (Object.keys(map).length >= MAX_ENTRIES && !map[key]) {
			throw new BizError('服务器上的过期记录已达上限');
		}
		const now = Date.now();
		map[key] = {
			email: accountRow.email,
			retention,
			expiresAt: now + Number(retention),
			createdAt: now,
			userId,
		};
		await this.saveMap(c, map);
		return {
			accountId,
			email: accountRow.email,
			retention,
			expiresAt: map[key].expiresAt,
			createdAt: now,
		};
	},

	// —— 删邮箱时清掉它的过期记录（供 account-api.js 的 DELETE /account/delete 调用）——
	// 本函数自己吞掉 KV 写失败（只记日志）：账号已经删了，不能因为清记录失败
	// 就让删除接口报错；残留的记录会在下次定时清扫里被清掉。
	async removeExpiry(c, accountId) {
		try {
			const key = String(accountId);
			const map = await this.loadMap(c);
			if (!map[key]) return false;
			delete map[key];
			await this.saveMap(c, map);
			return true;
		} catch (err) {
			console.error('[expiry-service] 清除过期记录失败 accountId=' + accountId + '：', err);
			return false;
		}
	},

	// —— 定时清扫（供 src/index.js 的 scheduled() 调用，传 { env } 进来）——
	// 对表里所有已到期的记录做彻底删除：账号行 + 该账号的全部邮件 + 附件，
	// 走的和 user-api 管理员删账号同一条路 accountService.physicsDelete()
	//（里面调 emailService.physicsDeleteByAccountId：先删附件再删邮件行）。
	// 注意：这比 DELETE /account/delete 更彻底——那个接口只把账号标 isDel=1
	// （软删除，邮件还留在数据库里）；临时邮箱到期自动删除要的就是彻底消失，
	// 所以这里用硬删除。前端页面打开时的本地 sweep 仍走软删除（可恢复），
	// 两者不冲突：软删过的账号到期后，定时任务一样会把它连邮件一起硬删干净。
	// 返回 { checked, expired, deleted[], pruned[], skipped[], leftForNextRun }。
	async sweepExpired(c) {
		const map = await this.loadMap(c);
		const now = Date.now();
		const expiredKeys = Object.keys(map).filter((k) => {
			const e = map[k];
			return e && typeof e.expiresAt === 'number' && e.expiresAt <= now;
		});
		const result = {
			checked: Object.keys(map).length,
			expired: expiredKeys.length,
			deleted: [],
			pruned: [],
			skipped: [],
			leftForNextRun: 0,
		};
		if (!expiredKeys.length) return result;

		const batch = expiredKeys.slice(0, MAX_SWEEP_PER_RUN);
		result.leftForNextRun = expiredKeys.length - batch.length;

		for (const key of batch) {
			const e = map[key];
			try {
				// 这里要连已软删除的账号也查出来（selectById 只返回未删除的，不够用），
				// 所以直接按 accountId 查一行；查不到说明账号早已被删干净，只清 KV 记录。
				const row = await orm(c).select().from(account)
					.where(eq(account.accountId, Number(key))).get();
				if (!row) {
					delete map[key];
					result.pruned.push(key);
					continue;
				}
				// 第二道防线：主邮箱绝不能被定时任务删掉（正常情况下 POST 已拦住）。
				if (e.userId) {
					const owner = await userService.selectById(c, e.userId);
					if (owner && row.email === owner.email) {
						delete map[key];
						result.skipped.push({ accountId: Number(key), reason: 'main-account' });
						continue;
					}
				}
				await accountService.physicsDelete(c, { accountId: Number(key) });
				delete map[key];
				result.deleted.push(e.email || key);
			} catch (err) {
				// 单个失败不影响其他：记录保留在 KV 里，下一次定时再试。
				console.error('[expiry-service] 清扫过期邮箱失败 accountId=' + key + '：', err);
				result.skipped.push({ accountId: Number(key), reason: 'error' });
			}
		}

		await this.saveMap(c, map);
		console.log('[expiry-service] sweep:', JSON.stringify(result));
		return result;
	},
};

export default expiryService;
