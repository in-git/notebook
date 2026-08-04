# 前端C端注册对接精简文档（开发对接专用，剔除冗余描述，直接给开发/AI生成代码）

## 一、注册接口 `/auth/c/register` POST

| 参数           | 必填   | 说明                                  |
| -------------- | ------ | ------------------------------------- |
| account        | 是     | 账号                                  |
| password       | 是     | **前端SM2加密后字符串，禁止明文传输** |
| validCode      | 条件   | 验证码开关开启则必填                  |
| validCodeReqNo | 条件   | 验证码接口返回请求号，开启验证码必填  |

请求示例

```json
{
  "account": "test001",
  "password": "SM2加密后的hex字符串",
  "validCode": "8k3d",
  "validCodeReqNo": "VREQ20260804123456789"
}
```

返回：成功 `code=200`，无 data，**不自动登录**，注册完需跳登录页

## 二、后端核心逻辑（按顺序执行）

1. 读取系统配置 `SNOWY_SYS_DEFAULT_ALLOW_REGISTER_FLAG_FOR_C`
   - false 或未配置 → 抛 `管理员未开启注册`
2. 读取系统配置 `SNOWY_SYS_DEFAULT_CAPTCHA_OPEN_FLAG_FOR_C`
   - true → 校验 `validCode` + `validCodeReqNo`（调用 `getPicCaptcha` 拿到的请求号）
   - false → 跳过验证码
3. `password` **SM2私钥解密**（后端持有私钥，前端只加密不解密）
4. 账号查重（CLIENT_USER 表）
   - 已存在 → 抛 `账号已存在`
5. 密码强度校验（`ClientPasswordUtl.validNewPassword`）
   - 长度：`SNOWY_SYS_DEFAULT_PASSWORD_MIN_LENGTH_FOR_C` / `_MAX_LENGTH_FOR_C`
   - 复杂度：`SNOWY_SYS_DEFAULT_PASSWORD_COMPLEXITY_FOR_C`（REG0~REG4，详见下方）
6. 密码做哈希（前端SM2解密 → 后端再哈希存储，**数据库不存明文也不存SM2密文**）
7. 写入 CLIENT_USER，分配雪花ID，默认 `userStatus=ENABLE`，来源 `SYSTEM_ADD`

## 三、密码复杂度枚举（与登录共用配置）

| 枚举值 | 正则                                    | 要求                       |
| ------ | --------------------------------------- | -------------------------- |
| REG0   | 无                                      | 不限制                     |
| REG1   | `^(?=.*[0-9])(?=.*[a-zA-Z]).+$`         | 数字+字母                  |
| REG2   | `^(?=.*[0-9])(?=.*[A-Z]).+$`            | 数字+大写字母              |
| REG3   | `^(?=.*[0-9])(?=.*[A-Z])(?=.*[a-z])(?=.*[^a-zA-Z0-9]).+$` | 数字+大小写+特殊字符 |
| REG4   | `^(?:(?=.*[0-9])(?=.*[a-zA-Z])\|(?=.*[0-9])(?=.*[^a-zA-Z0-9])\|(?=.*[a-zA-Z])(?=.*[^a-zA-Z0-9])).+$` | 三选二（数字/字母/特殊字符） |

## 四、SM2加密（与登录完全一致）

公钥固定

```js
import smCrypto from 'sm-crypto';
const publicKey =
  '04298364ec840088475eae92a591e01284d1abefcda348b47eb324bb521bb03b0b2a5bc393f6b71dabb8f15c99a0050818b56b23f31743b93df9cf8948f15ddb54';
// 调用：doEncrypt(原始密码)，输出hex字符串作为password参数
smCrypto.sm2.doEncrypt(msg, publicKey, 1);
```

## 五、注册成功后的页面跳转

注册接口**不返回token**，必须引导用户回登录页

```js
// 注册成功
message.success('注册成功，请登录')
router.replace('/front/client/login')
```

> 使用 `replace` 禁止 `push`，防止浏览器回退到注册页

## 六、关联接口（注册页可能用到）

| 接口                                  | 用途                  |
| ------------------------------------- | --------------------- |
| `/auth/c/getPicCaptcha` GET           | 获取图形验证码+请求号 |
| `/sys/config/getByKey/SNOWY_SYS_DEFAULT_ALLOW_REGISTER_FLAG_FOR_C` | 查注册开关（前端预判可注册） |

## 七、关键约束（硬性，必须遵守）

1. **密码必须前端SM2加密**，严禁明文传 `password`
2. **注册接口不自动登录**，前端必须跳登录页
3. 账号查重在 C 端 `CLIENT_USER` 表，**不是 B 端 `BIZ_USER`**
4. 验证码开关 `SNOWY_SYS_DEFAULT_CAPTCHA_OPEN_FLAG_FOR_C` 由系统配置控制，前端不能硬编码
5. 注册前先调 `getPicCaptcha` 拿到 `validCodeReqNo`，两者必须配套
6. 密码复杂度遵循后端配置，**前端只做非空和长度初判，最终以服务端为准**
7. 接口路径前缀固定 `/auth/c/`，与登录保持一致

## 八、典型注册页表单字段

| 字段         | 类型   | 校验                            |
| ------------ | ------ | ------------------------------- |
| account      | string | 必填，3-20位，账号不能含中文    |
| password     | string | 必填，8-20位，规则同后端复杂度  |
| confirmPwd   | string | 必填，与 password 一致          |
| validCode    | string | 验证码开启时必填                |
| agree        | bool   | 必选 true（用户协议）           |

提交前前端处理

```js
// 1. 密码做SM2加密
const passwordEncrypted = smCrypto.sm2.doEncrypt(password, publicKey, 1)
// 2. 提交
await clientLoginApi.clientRegister({
  account,
  password: passwordEncrypted,
  validCode,
  validCodeReqNo
})
```
