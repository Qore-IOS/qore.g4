import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const iconsDir = path.join(process.cwd(), 'public', 'icons');
    if (!fs.existsSync(iconsDir)) {
      return NextResponse.json({ icons: [] });
    }
    const files = fs.readdirSync(iconsDir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico'].includes(ext);
    });
    return NextResponse.json({ icons: files.sort() });
  } catch {
    return NextResponse.json({ icons: [] });
  }
}
