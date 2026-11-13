const KvConst = {
	AUTH_INFO: 'auth-uid:',
	SETTING: 'setting:',
	SEND_DAY_COUNT: 'send_day_count:',
	PUBLIC_KEY: "public_key:",
	// ===== PATCH：新增（有效期补丁）。邮箱有效期表存在这个 key 下，值是 JSON 对象，
	// accountId -> {email, retention, expiresAt, createdAt, userId}，例如：
	// {"12": {"email": "x@daju123.xyz", "retention": "86400000", "expiresAt": 1793123456789, "createdAt": 1793037056789, "userId": 3}}
	// 删掉这个 key 即清空全站所有邮箱的有效期记录（邮箱本身不受影响，全部变回永久保留）。
	MAILBOX_EXPIRY: 'mailbox_expiry',
	// ===== PATCH：新增（域名管理补丁）。额外域名（本面板添加的域名）存在这个 key 下，值是 JSON 数组，例如 ["yuxuaimi.xyz"] =====
	// 故意不用 ':' 后缀：它是一个完整 key，不是"前缀 + id"；且不与现有任何 key 前缀冲突。
	// 删除这个 key（Cloudflare 后台 KV 里删，或 wrangler kv:key delete）即回滚到"仅 env 域名"。
	CUSTOM_DOMAINS: 'custom_domains'
}

export default KvConst;
