import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { requireAdmin } from '../../middleware/session';
import quizSets from './quizSets';
import reports from './reports';
import stats from './stats';
import subjects from './subjects';
import users from './users';

// admin ルータの土台。/api/admin にマウントされ、全ルートで requireAdmin を強制する（§7.7）。
const admin = new Hono<AppEnv>();

admin.use('*', requireAdmin);

admin.route('/subjects', subjects);
admin.route('/reports', reports);
admin.route('/quiz-sets', quizSets);
admin.route('/users', users);
admin.route('/stats', stats);

export default admin;
