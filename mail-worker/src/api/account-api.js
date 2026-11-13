import app from '../hono/hono';
import accountService from '../service/account-service';
// ===== PATCH：新增导入（有效期补丁）=====
import expiryService from '../service/expiry-service';
import result from '../model/result';
import userContext from '../security/user-context';

app.get('/account/list', async (c) => {
	const list = await accountService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.delete('/account/delete', async (c) => {
	await accountService.delete(c, c.req.query(), userContext.getUserId(c));
	// ===== PATCH：删邮箱时顺带清掉它的服务器端过期记录。removeExpiry() 自己吞掉
	// KV 写失败（只记日志），绝不会让删除接口报错；残留记录会在下次定时清扫里清掉。=====
	await expiryService.removeExpiry(c, c.req.query().accountId);
	return c.json(result.ok());
});

app.post('/account/add', async (c) => {
	const account = await accountService.add(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(account));
});

app.put('/account/setName', async (c) => {
	await accountService.setName(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/account/setAllReceive', async (c) => {
	await accountService.setAllReceive(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/account/setAsTop', async (c) => {
	await accountService.setAsTop(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});
