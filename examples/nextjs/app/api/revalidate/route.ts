import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const tag = request.nextUrl.searchParams.get('tag');

  if (!tag) {
    return NextResponse.json({ error: 'Missing ?tag= parameter' }, { status: 400 });
  }

  revalidateTag(tag, { expire: 0 });

  return NextResponse.json({ revalidated: true, tag });
}
