// P1-19 acceptance only: every line below must fail the security stage. Never merged.
const awsAccessKeyId = 'AKIAXD5MELUGIEDYL7IN'
const awsSecretAccessKey = 'c8lJSFkuKkl9tGGDe18At8SjJsI5J6p6t17NVj'

export function unsafe(input: string) {
  return [awsAccessKeyId, awsSecretAccessKey, eval(input)]
}
