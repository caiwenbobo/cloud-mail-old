import app from '../hono/hono';
import result from '../model/result';
import settingService from '../service/setting-service';
// ===== PATCH：新增导入 =====
import domainService from '../service/domain-service';

app.put('/setting/set', async (c) => {
	await settingService.set(c, await c.req.json());
	return c.json(result.ok());
});

app.get('/setting/query', async (c) => {
	const setting = await settingService.get(c);
	return c.json(result.ok(setting));
});

app.get('/setting/websiteConfig', async (c) => {
	const setting = await settingService.websiteConfig(c);
	return c.json(result.ok(setting));
})

app.put('/setting/setBackground', async (c) => {
	const key = await settingService.setBackground(c, await c.req.json());
	return c.json(result.ok(key));
});

app.delete('/setting/deleteBackground', async (c) => {
	await settingService.deleteBackground(c);
	return c.json(result.ok());
});

// ===== PATCH：新增——域名管理（仅管理员；domain-service.requireAdmin 里按 c.env.admin 校验）=====
// 注意：这三个路由不在 security.js 的 exclude 列表里，所以一律先过 JWT 鉴权
// （token 用原始 Authorization 头，和全站其他接口一样）；再加 requirePerms 映射（见 patches/security.patch）。

// GET /setting/domains：返回 [{ domain: "daju123.xyz", source: "env" | "custom" }, ...]
//   env = Worker 的 domain 配置；custom = 本面板在 KV 里添加的。新建邮箱下拉框用的
//   websiteConfig.domainList 会自动包含这两类，无需前端再调这个接口去拼下拉框。
app.get('/setting/domains', async (c) => {
	const list = await domainService.listDomains(c);
	return c.json(result.ok(list));
});

// POST /setting/domain/add { domain: "yuxuaimi.xyz" }：加一个 KV 域名；返回更新后的完整列表。
//   域名不用带 @，大小写、首尾空格、多余的点由后端归一化；已在 env 里的会报错提示无需重复添加。
app.post('/setting/domain/add', async (c) => {
	const list = await domainService.addDomain(c, await c.req.json());
	return c.json(result.ok(list));
});

// POST /setting/domain/delete { domain: "yuxuaimi.xyz" }：删一个 KV 域名；返回更新后的完整列表。
//   env 里的域名删不掉（会报错，提示去改 Worker 配置）。
//   注意：删域名不会删掉已经用这个域名建好的邮箱和邮件，那些账号仍可收信、仍在列表里。
app.post('/setting/domain/delete', async (c) => {
	const list = await domainService.deleteDomain(c, await c.req.json());
	return c.json(result.ok(list));
});
