import { Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Feed from './pages/Feed'
import PostDetail from './pages/PostDetail'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import AdminPanel from './pages/AdminPanel'
import Pipeline from './pages/Pipeline'
import PipelineIdea from './pages/PipelineIdea'
import MentorReview from './pages/MentorReview'
import TeamAcquisition from './pages/TeamAcquisition'
import ProblemHub from './pages/ProblemHub'
import ProblemDetail from './pages/ProblemDetail'
import Calendar from './pages/Calendar'
import Directory from './pages/Directory'
import UserProfile from './pages/UserProfile'
import Notifications from './pages/Notifications'
import Onboarding from './pages/Onboarding'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import OnboardingGate from './components/OnboardingGate'
import PasswordChangeGate from './components/PasswordChangeGate'
import PublicOnlyRoute from './components/PublicOnlyRoute'
import AutopsyLibrary from './pages/AutopsyLibrary'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
      <Route path="/forgot-password" element={<PublicOnlyRoute><ForgotPassword /></PublicOnlyRoute>} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* first-time profile setup (authed, but outside the app shell). PasswordChangeGate
          forces a temp-password user to set their own password before anything else. */}
      <Route path="/onboarding" element={<ProtectedRoute><PasswordChangeGate><Onboarding /></PasswordChangeGate></ProtectedRoute>} />

      {/* authed app shell: topbar + left rail, pages render in the Outlet. Temp-password users
          must set a password (PasswordChangeGate); incomplete profiles are bounced to
          /onboarding by OnboardingGate. */}
      <Route element={<ProtectedRoute><PasswordChangeGate><OnboardingGate><Layout /></OnboardingGate></PasswordChangeGate></ProtectedRoute>}>
        <Route index element={<Feed />} />
        <Route path="post/:id" element={<PostDetail />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings" element={<Settings />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="pipeline/:id" element={<PipelineIdea />} />
        <Route path="mentor" element={<MentorReview />} />
        <Route path="team" element={<TeamAcquisition />} />
        <Route path="problem-hub" element={<ProblemHub />} />
        <Route path="problem-hub/:id" element={<ProblemDetail />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="directory" element={<Directory />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="u/:id" element={<UserProfile />} />
        <Route path="admin" element={<AdminPanel />} />
        <Route path="autopsy-library" element={<AutopsyLibrary />} />
      </Route>
    </Routes>
  )
}

export default App