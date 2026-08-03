// SM2 非对称加密封装（密码前端加密，对接文档第三章固定公钥）
// 使用 sm-crypto npm 包，调用方式：smCrypto.sm2.doEncrypt(msg, publicKey, 1)
// 输出 hex 字符串作为 password 参数

import smCrypto from 'sm-crypto';

// 对接文档约定：公钥固定
export const SM2_PUBLIC_KEY =
  '04298364ec840088475eae92a591e01284d1abefcda348b47eb324bb521bb03b0b2a5bc393f6b71dabb8f15c99a0050818b56b23f31743b93df9cf8948f15ddb54';

/**
 * 使用固定公钥 SM2 加密明文（密码）
 * @param plain 明文密码
 * @returns hex 字符串（无 0x 前缀），作为 password 参数上传
 */
export const sm2Encrypt = (plain: string): string => {
  if (!plain) return '';
  return smCrypto.sm2.doEncrypt(plain, SM2_PUBLIC_KEY, 1);
};
