'use cache';

import { cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { posts } from '../data';

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = posts.find((p) => p.id === Number(id));

  if (!post) notFound();

  cacheTag('posts', `post:${post.id}`);

  return (
    <main>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
      <p>
        Rendered at: <strong>{new Date().toISOString()}</strong>
      </p>
      <p>
        Worker: <code>{process.env.ORKIFY_WORKER_ID ?? 'standalone'}</code>
      </p>
      <p>
        <a href="/posts">← All Posts</a>
      </p>
    </main>
  );
}
