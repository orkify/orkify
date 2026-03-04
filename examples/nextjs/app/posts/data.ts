export interface Post {
  id: number;
  title: string;
  body: string;
}

export const posts: Post[] = [
  { id: 1, title: 'Getting Started with orkify', body: 'orkify is a modern process manager...' },
  { id: 2, title: 'Cluster Mode', body: 'Run multiple workers with shared port...' },
  { id: 3, title: 'Cache Sharing', body: 'orkify/cache syncs across all workers...' },
];
