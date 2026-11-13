const KvConst = {
	AUTH_INFO: 'auth-uid:',
	SETTING: 'setting:',
	SEND_DAY_COUNT: 'send_day_count:',
	PUBLIC_KEY: "public_key:",
	// ===== PATCH：新增（有效期补丁）。邮箱有效期表存在这个 key 下，值是 JSON 对象，
	// accountId -> {email, retention, expiresAt, createdAt, userId}，例如：
	// {"12": {"email": "x@daju123.xyz", "retention": "86400000", "expiresAt": 1793123456789, "createdAt": 1793037056789, "userId": 3}}
	// 删掉这个 key 即清空全站所有邮箱的有效期记录（邮箱本身不受影响，全部变回永久保留）。
	MAILBOX_EXPIRY: 'mailbox_expiry'
}

export default KvConst;
