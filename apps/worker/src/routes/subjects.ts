import type { Subject } from '@memorix/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../env';

const subjects = new Hono<AppEnv>();

interface SubjectRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_active: number;
}

function toSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    icon: row.icon,
    color: row.color,
    displayOrder: row.display_order,
    isActive: row.is_active === 1,
  };
}

// GET /api/subjects: 認証不要。is_active=1 の科目一覧（display_order 順）（§7.2）
subjects.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, slug, name, icon, color, display_order, is_active FROM subjects WHERE is_active = 1 ORDER BY display_order, id',
  ).all<SubjectRow>();
  return c.json(results.map(toSubject));
});

export default subjects;
