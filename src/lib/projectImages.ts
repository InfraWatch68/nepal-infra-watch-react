export function projectPlaceholderImage(projectId: string | number | null | undefined) {
  return `https://picsum.photos/seed/${encodeURIComponent(String(projectId ?? 'project'))}/400/250`;
}

export function projectCoverImage(project: any) {
  const cover = project?.cover_image_url?.trim?.();
  return cover || projectPlaceholderImage(project?.id);
}
