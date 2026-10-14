import { Hono } from 'hono';
import type { AppEnv } from './env';
import { sessionMiddleware } from './middleware/session';
import admin from './routes/admin/index';
import auth from './routes/auth';
import discover from './routes/discover';
import img from './routes/img';
import invites from './routes/invites';
import me from './routes/me';
import quizSets from './routes/quizSets';
import reports from './routes/reports';
import sessions from './routes/sessions';
import share from './routes/share';
import { quizBookmark } from './routes/social';
import subjects from './routes/subjects';
import teams from './routes/teams/index';

export type { AppEnv, Env, SessionUser } from './env';

const app = new Hono<AppEnv>();

app.use('/api/*', sessionMiddleware);

app.get('/api/health', (c) => c.json({ status: 'ok' }));
app.route('/api/auth', auth);
app.route('/api/me', me);
app.route('/api/teams', teams);
app.route('/api/invites', invites);
app.route('/api/quiz-sets', quizSets);
app.route('/api/quiz-sets', quizBookmark);
app.route('/api/quiz-sets', reports);
app.route('/api/sessions', sessions);
app.route('/api/share', share);
app.route('/api/subjects', subjects);
app.route('/api/discover', discover);
app.route('/api/admin', admin);
app.route('/img', img);

export default app;
