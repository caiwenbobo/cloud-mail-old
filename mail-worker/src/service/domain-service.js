import KvConst from '../const/kv-const';
import BizError from '../error/biz-error';
import verifyUtils from '../utils/verify-utils';

// ============================================================================
// PATCH（新增文件）：域名管理 —— 额外域名存在 Worker 自带的 KV 里
// ----------------------------------------------------------------------------
// 设计：
//   - env 里的 domain（Worker 变量/密钥，部署时写死）永远保留、永远优先；
//   - 本面板添加的域名只追加进 KV（key 见 kv-const.js 新增的 CUSTOM_DOMAINS），
//     不改 env、不改 wrangler.toml、不动数据库；
//   - 所有原来读 c.env.domain 的地方，改成读“env + KV 合并后的列表”。
// 存储格式：KV 值是 JSON 数组，只存不带 @ 的小写裸域名，例如：
//   ["yuxuaimi.xyz", "yuxiaomi.xyz"]
// 本文件只用 c.env，不用 c.get / c.set，所以在 Hono 路由和 email.js 那种
// 纯 { env } 调用里都能用；循环引用：本文件不引用任何 service。
// ============================================================================

const MAX_CUSTOM_DOMAINS = 20;

const domainService = {
	// —— 归一化：小写、去空格、去开头的 @、去结尾的点；不合法返回 '' ——
	normalizeDomain(input) {
		if (typeof input !== 'string') return '';
		let d = input.trim().toLowerCase();
		if (d.startsWith('@')) d = d.slice(1);
		while (d.endsWith('.')) d = d.slice(0, -1);
		if (!verifyUtils.isDomain(d)) return '';
		return d;
	},

	// —— 解析 env domain：数组直接用；JSON 字符串先解析；解析失败时，
	//    如果本身就是一个合法裸域名就按单个域名处理，否则返回 [] ——
	parseEnvDomains(c) {
		const raw = c.env.domain;
		if (!raw) return [];
		if (Array.isArray(raw)) {
			return raw
				.filter((x) => typeof x === 'string')
				.map((x) => x.trim().toLowerCase())
				.filter(Boolean);
		}
		if (typeof raw === 'string') {
			try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					return parsed
						.filter((x) => typeof x === 'string')
						.map((x) => x.trim().toLowerCase())
						.filter(Boolean);
				}
				return [];
			} catch (e) {
				const single = raw.trim().toLowerCase().replace(/^@/, '');
				return verifyUtils.isDomain(single) ? [single] : [];
			}
		}
		return [];
	},

	// —— 读 KV 里的额外域名。任何失败（KV 未绑定、值不是合法 JSON、不是数组）
	//    都返回 []，绝不抛错：调用方永远退回“仅 env 域名”的旧行为 ——
	async getCustomDomains(c) {
		try {
			const raw = await c.env.kv.get(KvConst.CUSTOM_DOMAINS);
			if (!raw) return [];
			const list = JSON.parse(raw);
			if (!Array.isArray(list)) return [];
			return [...new Set(
				list
					.filter((x) => typeof x === 'string')
					.map((x) => x.trim().toLowerCase())
					.filter((x) => verifyUtils.isDomain(x))
			)];
		} catch (e) {
			console.error('[domain-service] 读取 KV 额外域名失败，已退回仅 env 域名：', e);
			return [];
		}
	},

	// —— 合并后的裸域名列表：env 在前、KV 追加、去重；KV 读失败时 = 仅 env ——
	async getAllBareDomains(c) {
		const envDomains = this.parseEnvDomains(c);
		const custom = await this.getCustomDomains(c);
		return [...new Set([...envDomains, ...custom])];
	},

	// —— 合并后带 @ 的列表（websiteConfig / 发信“站内判断”用的就是这个格式） ——
	async getAllDomains(c) {
		const bare = await this.getAllBareDomains(c);
		return bare.map((d) => '@' + d);
	},

	// —— 供管理面板：每个域名标明来源 env（Worker 配置）或 custom（本面板添加） ——
	async listDomains(c) {
		const envDomains = this.parseEnvDomains(c);
		const custom = await this.getCustomDomains(c);
		const envSet = new Set(envDomains);
		return [
			...envDomains.map((d) => ({ domain: d, source: 'env' })),
			...custom.filter((d) => !envSet.has(d)).map((d) => ({ domain: d, source: 'custom' })),
		];
	},

	// —— 管理员校验：复用现有机制 —— 只有登录邮箱 === c.env.admin 才是管理员 ——
	//    security.js 里也是这样判断 admin 的（authInfo.user.email !== c.env.admin 则鉴权失败）。
	//    注意：GET /setting/domains 等路由本身也要进 security.js 的 requirePerms（见 patches/security.patch），
	//    这里是第二道防线；即使将来有人忘了配权限表，非管理员也进不来。
	requireAdmin(c) {
		const user = c.get?.('user');
		if (!user || user.email !== c.env.admin) {
			throw new BizError('仅管理员可以管理域名', 403);
		}
	},

	async addDomain(c, params) {
		this.requireAdmin(c);
		const domain = this.normalizeDomain(params && params.domain);
		if (!domain) {
			throw new BizError('域名格式不正确，例如 yuxuaimi.xyz');
		}
		const envDomains = this.parseEnvDomains(c);
		if (envDomains.includes(domain)) {
			throw new BizError('该域名已在环境变量域名中，无需重复添加');
		}
		const custom = await this.getCustomDomains(c);
		if (custom.includes(domain)) {
			throw new BizError('该域名已存在');
		}
		if (custom.length >= MAX_CUSTOM_DOMAINS) {
			throw new BizError('额外域名已达上限（' + MAX_CUSTOM_DOMAINS + ' 个），请先删除不用的域名');
		}
		const next = [...custom, domain];
		await c.env.kv.put(KvConst.CUSTOM_DOMAINS, JSON.stringify(next));
		return this.listDomains(c);
	},

	async deleteDomain(c, params) {
		this.requireAdmin(c);
		const domain = this.normalizeDomain(params && params.domain);
		if (!domain) {
			throw new BizError('域名格式不正确');
		}
		const envDomains = this.parseEnvDomains(c);
		if (envDomains.includes(domain)) {
			throw new BizError('环境变量中的域名不能在这里删除，请改 Worker 的 domain 配置');
		}
		const custom = await this.getCustomDomains(c);
		if (!custom.includes(domain)) {
			throw new BizError('该域名不存在');
		}
		const next = custom.filter((d) => d !== domain);
		await c.env.kv.put(KvConst.CUSTOM_DOMAINS, JSON.stringify(next));
		return this.listDomains(c);
	},
};

export default domainService;
