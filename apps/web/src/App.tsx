import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { Dashboard as AdminDashboard } from './routes/admin/Dashboard';
import { Reports as AdminReports } from './routes/admin/Reports';
import { Subjects as AdminSubjects } from './routes/admin/Subjects';
import { Users as AdminUsers } from './routes/admin/Users';
import { Bookmarks } from './routes/Bookmarks';
import { History } from './routes/History';
import { Home } from './routes/Home';
import { InviteAccept } from './routes/InviteAccept';
import { Login } from './routes/Login';
import { Play } from './routes/Play';
import { Privacy } from './routes/Privacy';
import { QuizCover } from './routes/QuizCover';
import { Result } from './routes/Result';
import { Search } from './routes/Search';
import { ShareCover } from './routes/ShareCover';
import { SubjectPage } from './routes/SubjectPage';
import { StudioImages } from './routes/studio/StudioImages';
import { StudioImport } from './routes/studio/StudioImport';
import { StudioMembers } from './routes/studio/StudioMembers';
import { StudioQuestions } from './routes/studio/StudioQuestions';
import { StudioQuizList } from './routes/studio/StudioQuizList';
import { StudioQuizSettings } from './routes/studio/StudioQuizSettings';
import { StudioSettings } from './routes/studio/StudioSettings';
import { StudioStats } from './routes/studio/StudioStats';
import { StudioTeams } from './routes/studio/StudioTeams';
import { TeamProfile } from './routes/TeamProfile';
import { Terms } from './routes/Terms';

function NotFound() {
  return (
    <div className="mx-auto max-w-sm space-y-3 p-8 text-center">
      <p className="text-sm text-gray-600">ページが見つかりませんでした。</p>
      <Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">
        トップへ戻る
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/subjects/:slug" element={<SubjectPage />} />
        <Route path="/teams/:id" element={<TeamProfile />} />
        <Route path="/quiz/:id" element={<QuizCover />} />
        <Route path="/share/:token" element={<ShareCover />} />
        <Route path="/play/:sessionId" element={<Play />} />
        <Route path="/result/:sessionId" element={<Result />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/invites/:token"
          element={
            <RequireAuth>
              <InviteAccept />
            </RequireAuth>
          }
        />
        <Route
          path="/bookmarks"
          element={
            <RequireAuth>
              <Bookmarks />
            </RequireAuth>
          }
        />
        <Route
          path="/history"
          element={
            <RequireAuth>
              <History />
            </RequireAuth>
          }
        />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/subjects" element={<AdminSubjects />} />
        <Route path="/admin/reports" element={<AdminReports />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route
          path="/studio"
          element={
            <RequireAuth>
              <StudioTeams />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/:teamId"
          element={
            <RequireAuth>
              <StudioQuizList />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/:teamId/quizzes/new"
          element={
            <RequireAuth>
              <StudioQuizSettings />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/:teamId/quizzes/:quizId"
          element={
            <RequireAuth>
              <StudioQuizSettings />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/:teamId/quizzes/:quizId/questions"
          element={
            <RequireAuth>
              <StudioQuestions />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/:teamId/quizzes/:quizId/import"
          element={
            <RequireAuth>
              <StudioImport />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/:teamId/quizzes/:quizId/stats"
          element={
            <RequireAuth>
              <StudioStats />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/:teamId/images"
          element={
            <RequireAuth>
              <StudioImages />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/:teamId/members"
          element={
            <RequireAuth>
              <StudioMembers />
            </RequireAuth>
          }
        />
        <Route
          path="/studio/:teamId/settings"
          element={
            <RequireAuth>
              <StudioSettings />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
