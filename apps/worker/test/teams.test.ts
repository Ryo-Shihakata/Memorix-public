import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newId } from '../src/lib/id';
import { addMember, errorCode, jsonInit, request, seedTeam, seedUser } from './helpers';

// ---- チーム CRUD（§7.5） -----------------------------------------------

describe('POST /api/teams', () => {
  it('作成者が owner のチームが作られる', async () => {
    const { id, cookie } = await seedUser();
    const res = await request(
      '/api/teams',
      jsonInit('POST', { name: '数学科', description: '説明' }, cookie),
    );
    expect(res.status).toBe(201);
    const team = (await res.json()) as {
      id: string;
      name: string;
      isPersonal: boolean;
      storageUsedBytes: number;
    };
    expect(team.name).toBe('数学科');
    expect(team.isPersonal).toBe(false);
    expect(team.storageUsedBytes).toBe(0);

    const member = await env.DB.prepare(
      'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    )
      .bind(team.id, id)
      .first<{ role: string }>();
    expect(member?.role).toBe('owner');
  });

  it('未ログインは 401、name 空は 400 VALIDATION', async () => {
    expect((await request('/api/teams', jsonInit('POST', { name: 'x' }))).status).toBe(401);
    const { cookie } = await seedUser();
    const res = await request('/api/teams', jsonInit('POST', { name: '' }, cookie));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION');
  });

  it('所有チームが10個あると 403 QUOTA_EXCEEDED', async () => {
    const { id, cookie } = await seedUser();
    for (let i = 0; i < 10; i++) {
      const teamId = await seedTeam();
      await addMember(teamId, id, 'owner');
    }
    const res = await request('/api/teams', jsonInit('POST', { name: '11個目' }, cookie));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('QUOTA_EXCEEDED');
  });
});

describe('GET/PATCH/DELETE /api/teams/:teamId', () => {
  it('viewer は詳細を見られる（storageUsedBytes 含む）、非メンバーは 403', async () => {
    const viewer = await seedUser();
    const outsider = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, viewer.id, 'viewer');

    const ok = await request(`/api/teams/${teamId}`, { headers: { cookie: viewer.cookie } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { storageUsedBytes: number };
    expect(body.storageUsedBytes).toBe(0);

    const ng = await request(`/api/teams/${teamId}`, { headers: { cookie: outsider.cookie } });
    expect(ng.status).toBe(403);
  });

  it('PATCH は owner のみ。editor は 403', async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    await addMember(teamId, editor.id, 'editor');

    const ok = await request(
      `/api/teams/${teamId}`,
      jsonInit('PATCH', { name: '新しい名前' }, owner.cookie),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { name: string }).name).toBe('新しい名前');

    const ng = await request(
      `/api/teams/${teamId}`,
      jsonInit('PATCH', { name: 'x' }, editor.cookie),
    );
    expect(ng.status).toBe(403);
  });

  it('PATCH の avatarImageId が存在しない画像なら 400', async () => {
    const owner = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    const res = await request(
      `/api/teams/${teamId}`,
      jsonInit('PATCH', { avatarImageId: newId() }, owner.cookie),
    );
    expect(res.status).toBe(400);
  });

  it('DELETE: owner は削除できる、個人チームは 400', async () => {
    const owner = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    const res = await request(`/api/teams/${teamId}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(204);
    expect(
      await env.DB.prepare('SELECT id FROM teams WHERE id = ?').bind(teamId).first(),
    ).toBeNull();

    const personalId = await seedTeam({ personal: true });
    await addMember(personalId, owner.id, 'owner');
    const ng = await request(`/api/teams/${personalId}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(ng.status).toBe(400);
  });

  it('admin は非メンバーでも owner 相当（PATCH/DELETE 可）', async () => {
    const admin = await seedUser('admin');
    const teamId = await seedTeam();
    const res = await request(
      `/api/teams/${teamId}`,
      jsonInit('PATCH', { name: 'admin編集' }, admin.cookie),
    );
    expect(res.status).toBe(200);
  });
});

// ---- メンバー管理（§7.5 + §6 補足） -------------------------------------

describe('members API', () => {
  it('GET members は viewer 以上。ページネーション形式で返る', async () => {
    const viewer = await seedUser();
    const outsider = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, viewer.id, 'viewer');

    const res = await request(`/api/teams/${teamId}/members`, {
      headers: { cookie: viewer.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ userId: string; role: string }>;
      total: number;
      page: number;
      perPage: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ userId: viewer.id, role: 'viewer' });

    expect(
      (await request(`/api/teams/${teamId}/members`, { headers: { cookie: outsider.cookie } }))
        .status,
    ).toBe(403);
  });

  it('PATCH role は owner のみ。editor→viewer の変更が反映される', async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    await addMember(teamId, editor.id, 'editor');

    const ng = await request(
      `/api/teams/${teamId}/members/${owner.id}`,
      jsonInit('PATCH', { role: 'viewer' }, editor.cookie),
    );
    expect(ng.status).toBe(403);

    const ok = await request(
      `/api/teams/${teamId}/members/${editor.id}`,
      jsonInit('PATCH', { role: 'viewer' }, owner.cookie),
    );
    expect(ok.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    )
      .bind(teamId, editor.id)
      .first<{ role: string }>();
    expect(row?.role).toBe('viewer');
  });

  it('最後の owner の降格は 400 LAST_OWNER、owner が2人なら降格できる', async () => {
    const owner1 = await seedUser();
    const owner2 = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner1.id, 'owner');

    const ng = await request(
      `/api/teams/${teamId}/members/${owner1.id}`,
      jsonInit('PATCH', { role: 'editor' }, owner1.cookie),
    );
    expect(ng.status).toBe(400);
    expect(await errorCode(ng)).toBe('LAST_OWNER');

    await addMember(teamId, owner2.id, 'owner');
    const ok = await request(
      `/api/teams/${teamId}/members/${owner1.id}`,
      jsonInit('PATCH', { role: 'editor' }, owner2.cookie),
    );
    expect(ok.status).toBe(200);
  });

  it('DELETE: owner はメンバーを外せる、本人は脱退できる、他人の viewer は 403', async () => {
    const owner = await seedUser();
    const viewer1 = await seedUser();
    const viewer2 = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    await addMember(teamId, viewer1.id, 'viewer');
    await addMember(teamId, viewer2.id, 'viewer');

    // viewer1 が viewer2 を外す → 403
    const ng = await request(`/api/teams/${teamId}/members/${viewer2.id}`, {
      method: 'DELETE',
      headers: { cookie: viewer1.cookie },
    });
    expect(ng.status).toBe(403);

    // owner が viewer2 を外す → 204
    const byOwner = await request(`/api/teams/${teamId}/members/${viewer2.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(byOwner.status).toBe(204);

    // viewer1 本人の脱退 → 204
    const self = await request(`/api/teams/${teamId}/members/${viewer1.id}`, {
      method: 'DELETE',
      headers: { cookie: viewer1.cookie },
    });
    expect(self.status).toBe(204);
  });

  it('最後の owner の脱退は 400 LAST_OWNER、個人チーム owner の脱退は 400', async () => {
    const owner = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    const ng = await request(`/api/teams/${teamId}/members/${owner.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(ng.status).toBe(400);
    expect(await errorCode(ng)).toBe('LAST_OWNER');

    const personalId = await seedTeam({ personal: true });
    await addMember(personalId, owner.id, 'owner');
    const ng2 = await request(`/api/teams/${personalId}/members/${owner.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(ng2.status).toBe(400);
    expect(await errorCode(ng2)).toBe('VALIDATION');
  });
});

// ---- 招待リンク（§7.5 + §11） -------------------------------------------

async function createInvite(
  teamId: string,
  cookie: string,
  body: Record<string, unknown> = { role: 'editor', expiresInHours: 24 },
): Promise<{ url: string; token: string }> {
  const res = await request(`/api/teams/${teamId}/invites`, jsonInit('POST', body, cookie));
  expect(res.status).toBe(201);
  const { url } = (await res.json()) as { url: string };
  const token = url.split('/').at(-1) ?? '';
  return { url, token };
}

describe('invites API', () => {
  it('owner は招待を発行できる（64桁 hex token の URL）、editor は 403', async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    await addMember(teamId, editor.id, 'editor');

    const { url, token } = await createInvite(teamId, owner.cookie);
    expect(url).toBe(`https://memorix.test/invites/${token}`);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const ng = await request(
      `/api/teams/${teamId}/invites`,
      jsonInit('POST', { role: 'viewer', expiresInHours: 24 }, editor.cookie),
    );
    expect(ng.status).toBe(403);
  });

  it('expiresInHours が 720 超・role=owner は 400 VALIDATION', async () => {
    const owner = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    const tooLong = await request(
      `/api/teams/${teamId}/invites`,
      jsonInit('POST', { role: 'editor', expiresInHours: 800 }, owner.cookie),
    );
    expect(tooLong.status).toBe(400);
    const ownerRole = await request(
      `/api/teams/${teamId}/invites`,
      jsonInit('POST', { role: 'owner', expiresInHours: 24 }, owner.cookie),
    );
    expect(ownerRole.status).toBe(400);
  });

  it('GET invites は有効な招待のみ。DELETE で失効し accept も 400 になる', async () => {
    const owner = await seedUser();
    const joiner = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    const { token } = await createInvite(teamId, owner.cookie);

    const list1 = await request(`/api/teams/${teamId}/invites`, {
      headers: { cookie: owner.cookie },
    });
    const body1 = (await list1.json()) as { items: Array<{ id: string }>; total: number };
    expect(body1.total).toBe(1);
    const inviteId = body1.items[0]?.id;

    const del = await request(`/api/teams/${teamId}/invites/${inviteId}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(del.status).toBe(204);

    const list2 = await request(`/api/teams/${teamId}/invites`, {
      headers: { cookie: owner.cookie },
    });
    expect(((await list2.json()) as { total: number }).total).toBe(0);

    const accept = await request(`/api/invites/${token}/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie },
    });
    expect(accept.status).toBe(400);
    expect(await accept.text()).toContain('失効');
  });

  it('正常受諾でメンバー追加 + use_count 増。既存メンバーは 409', async () => {
    const owner = await seedUser();
    const joiner = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    const { token } = await createInvite(teamId, owner.cookie, {
      role: 'editor',
      expiresInHours: 24,
    });

    const accept = await request(`/api/invites/${token}/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie },
    });
    expect(accept.status).toBe(200);
    expect((await accept.json()) as object).toEqual({ teamId, role: 'editor' });

    const member = await env.DB.prepare(
      'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    )
      .bind(teamId, joiner.id)
      .first<{ role: string }>();
    expect(member?.role).toBe('editor');

    const invite = await env.DB.prepare('SELECT use_count FROM team_invites WHERE token = ?')
      .bind(token)
      .first<{ use_count: number }>();
    expect(invite?.use_count).toBe(1);

    const again = await request(`/api/invites/${token}/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie },
    });
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('CONFLICT');
  });

  it('プレビューは未ログインでも {teamName, role}。不明 token は 404', async () => {
    const owner = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    const { token } = await createInvite(teamId, owner.cookie, {
      role: 'viewer',
      expiresInHours: 24,
    });

    const res = await request(`/api/invites/${token}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toEqual({ teamName: 'Seeded Team', role: 'viewer' });

    expect((await request('/api/invites/no-such-token')).status).toBe(404);
  });

  it('期限切れの招待は preview/accept とも 400', async () => {
    const joiner = await seedUser();
    const teamId = await seedTeam();
    const token = 'e'.repeat(64);
    await env.DB.prepare(
      `INSERT INTO team_invites (id, team_id, token, role, expires_at)
       VALUES (?, ?, ?, 'viewer', datetime('now', '-1 hour'))`,
    )
      .bind(newId(), teamId, token)
      .run();

    const preview = await request(`/api/invites/${token}`);
    expect(preview.status).toBe(400);
    expect(await preview.text()).toContain('有効期限');

    const accept = await request(`/api/invites/${token}/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie },
    });
    expect(accept.status).toBe(400);
  });

  it('maxUses に達した招待は 400', async () => {
    const owner = await seedUser();
    const joiner1 = await seedUser();
    const joiner2 = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');
    const { token } = await createInvite(teamId, owner.cookie, {
      role: 'viewer',
      expiresInHours: 24,
      maxUses: 1,
    });

    const first = await request(`/api/invites/${token}/accept`, {
      method: 'POST',
      headers: { cookie: joiner1.cookie },
    });
    expect(first.status).toBe(200);

    const second = await request(`/api/invites/${token}/accept`, {
      method: 'POST',
      headers: { cookie: joiner2.cookie },
    });
    expect(second.status).toBe(400);
    expect(await second.text()).toContain('使用回数');
  });

  it('メンバー100人のチームへの受諾は 403 QUOTA_EXCEEDED', async () => {
    const owner = await seedUser();
    const joiner = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, owner.id, 'owner');

    // owner を含め100人にする（99人追加）
    const stmts = [];
    for (let i = 0; i < 99; i++) {
      const uid = newId();
      stmts.push(
        env.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(
          uid,
          `${uid}@example.com`,
          `bulk-${i}`,
        ),
        env.DB.prepare(
          "INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'viewer')",
        ).bind(teamId, uid),
      );
    }
    await env.DB.batch(stmts);

    const { token } = await createInvite(teamId, owner.cookie);
    const res = await request(`/api/invites/${token}/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie },
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('QUOTA_EXCEEDED');
  });

  it('accept は 20回/時/IP でレートリミットされる（§11）', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.9' };
    for (let i = 0; i < 20; i++) {
      const res = await request('/api/invites/xxxx/accept', { method: 'POST', headers });
      expect(res.status).toBe(401); // RL は消費されるが未ログインで 401
    }
    const blocked = await request('/api/invites/xxxx/accept', { method: 'POST', headers });
    expect(blocked.status).toBe(429);
    expect(await errorCode(blocked)).toBe('RATE_LIMITED');

    // 別 IP は別カウント
    const other = await request('/api/invites/xxxx/accept', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
    });
    expect(other.status).toBe(401);
  });
});

// ---- フォルダ（§7.6） ----------------------------------------------------

describe('folders API', () => {
  it('viewer は作成不可(403)、editor は作成できる(201)。§6 マトリクス', async () => {
    const editor = await seedUser();
    const viewer = await seedUser();
    const teamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await addMember(teamId, viewer.id, 'viewer');

    const ng = await request(
      `/api/teams/${teamId}/folders`,
      jsonInit('POST', { name: '第1章' }, viewer.cookie),
    );
    expect(ng.status).toBe(403);

    const ok = await request(
      `/api/teams/${teamId}/folders`,
      jsonInit('POST', { name: '第1章' }, editor.cookie),
    );
    expect(ok.status).toBe(201);
    const folder = (await ok.json()) as { id: string; name: string; displayOrder: number };
    expect(folder.name).toBe('第1章');
    expect(folder.displayOrder).toBe(0);

    // 2個目は displayOrder が進む
    const second = await request(
      `/api/teams/${teamId}/folders`,
      jsonInit('POST', { name: '第2章' }, editor.cookie),
    );
    expect(((await second.json()) as { displayOrder: number }).displayOrder).toBe(1);
  });

  it('GET/PATCH/DELETE。他チームのフォルダは 404', async () => {
    const editor = await seedUser();
    const teamId = await seedTeam();
    const otherTeamId = await seedTeam();
    await addMember(teamId, editor.id, 'editor');
    await addMember(otherTeamId, editor.id, 'editor');

    const created = await request(
      `/api/teams/${teamId}/folders`,
      jsonInit('POST', { name: '章' }, editor.cookie),
    );
    const folder = (await created.json()) as { id: string };

    const list = await request(`/api/teams/${teamId}/folders`, {
      headers: { cookie: editor.cookie },
    });
    expect(((await list.json()) as { total: number }).total).toBe(1);

    const patched = await request(
      `/api/teams/${teamId}/folders/${folder.id}`,
      jsonInit('PATCH', { name: '改名', displayOrder: 5 }, editor.cookie),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()) as object).toMatchObject({ name: '改名', displayOrder: 5 });

    // 他チーム経由の PATCH は 404
    const cross = await request(
      `/api/teams/${otherTeamId}/folders/${folder.id}`,
      jsonInit('PATCH', { name: 'x' }, editor.cookie),
    );
    expect(cross.status).toBe(404);

    const del = await request(`/api/teams/${teamId}/folders/${folder.id}`, {
      method: 'DELETE',
      headers: { cookie: editor.cookie },
    });
    expect(del.status).toBe(204);
  });
});
