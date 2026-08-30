const projectIdPattern = /^[A-Za-z0-9_-]{3,100}$/u;

export const projectIdFromPathname = (pathname: string): string | null => {
  const match = /^\/projects\/([^/]+)\/?$/u.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const projectId = decodeURIComponent(match[1]);
    return projectIdPattern.test(projectId) ? projectId : null;
  } catch {
    return null;
  }
};

export const projectPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}`;
