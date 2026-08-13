import 'server-only'

import AlibabaCredential, { Config as AlibabaCredentialConfig } from '@alicloud/credentials'

type CredentialType = 'access_key' | 'sts' | 'ecs_ram_role'

function value(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

function credentialConfig() {
  const type = (value('ALIBABA_CLOUD_CREDENTIALS_TYPE') || '').toLowerCase() as CredentialType
  const accessKeyId = value('ALIBABA_CLOUD_ACCESS_KEY_ID')
  const accessKeySecret = value('ALIBABA_CLOUD_ACCESS_KEY_SECRET')
  const securityToken = value('ALIBABA_CLOUD_SECURITY_TOKEN')
  if (type === 'ecs_ram_role') {
    return {
      type,
      roleName: value('ALIBABA_CLOUD_ECS_METADATA'),
      disableIMDSv1: true,
    }
  }
  if ((type === 'access_key' || type === 'sts' || (!type && accessKeyId && accessKeySecret))
      && accessKeyId && accessKeySecret) {
    return securityToken
      ? { type: 'sts', accessKeyId, accessKeySecret, securityToken }
      : { type: 'access_key', accessKeyId, accessKeySecret }
  }
  throw new Error('阿里云凭证未配置')
}

let cached: { key: string; credential: AlibabaCredential } | undefined

export async function getAlibabaAccessCredentials(): Promise<{
  accessKeyId: string
  accessKeySecret: string
  securityToken?: string
}> {
  const config = credentialConfig()
  const key = JSON.stringify(config)
  if (!cached || cached.key !== key) {
    cached = { key, credential: new AlibabaCredential(new AlibabaCredentialConfig(config)) }
  }
  const model = await cached.credential.getCredential()
  if (!model.accessKeyId || !model.accessKeySecret) throw new Error('阿里云临时凭证不完整')
  return {
    accessKeyId: model.accessKeyId,
    accessKeySecret: model.accessKeySecret,
    securityToken: model.securityToken || undefined,
  }
}
