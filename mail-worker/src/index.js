import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from "./service/oauth-service";
// ===== PATCH：新增导入（有效期补丁）=====
import expiryService from './service/expiry-service';
export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		 if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			 return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		 }

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(controller, env, ctx) {
		// ===== PATCH：controller.cron 是触发这次运行的 cron 表达式（Cloudflare 会传进来）。
		// 日常任务只在每天 00:00（北京时间，即 UTC 16:00）的那次跑；每小时的那次只跑
		// 过期邮箱清扫。必须分开：resetDaySendCount() 是按天重置发信数，每小时跑一次
		// 会让每日发信上限失效。原先这里没有分支，是因为只有一个 cron；加了每小时
		// 的 cron 后，不分支就是 bug。
		if (controller.cron === '0 16 * * *') {
			await verifyRecordService.clearRecord({ env })
			await userService.resetDaySendCount({ env })
			await emailService.completeReceiveAll({ env })
			await oauthService.clearNoBindOathUser({ env })
		}
		// ===== PATCH：过期邮箱清扫，每次定时触发都跑（每小时一次；每天 00:00 那次也会跑一次）=====
		// 幂等：已经删过的记录不在表里，下次跑直接跳过。
		await expiryService.sweepExpired({ env })
	},
};
