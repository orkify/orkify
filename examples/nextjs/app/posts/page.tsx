'use cache';

import { cacheTag } from 'next/cache';
import { posts } from './data';

export default async function PostsPage() {
  cacheTag('posts');

  return (
    <main>
      <h1>Posts</h1>
      <p>
        Rendered at: <strong>{new Date().toISOString()}</strong>
      </p>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            <a href={`/posts/${post.id}`}>{post.title}</a>
          </li>
        ))}
      </ul>
      <p>
        <a href="/api/revalidate?tag=posts">Revalidate posts</a>
      </p>
      <p>
        <a href="/">← Home</a>
      </p>
    </main>
  );
}
