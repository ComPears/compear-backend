export interface DeploymentMetadata {
  commit: string | null;
  service: string | null;
  environment: string;
}

export function getDeploymentMetadata(
  env: NodeJS.ProcessEnv = process.env
): DeploymentMetadata {
  return {
    commit: env.RENDER_GIT_COMMIT || env.COMMIT_SHA || env.GITHUB_SHA || null,
    service: env.RENDER_SERVICE_NAME || env.SERVICE_NAME || null,
    environment: env.NODE_ENV || 'development',
  };
}
