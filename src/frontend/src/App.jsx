import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import ChildChat from './pages/ChildChat'
import ParentDashboard from './pages/ParentDashboard'
import ModeratorDashboard from './pages/ModeratorDashboard'
import AdminDashboard from './pages/AdminDashboard'

// Top-level routing. The app has two sides:
//   /child  -> the voice avatar the child talks to
//   /parent -> the parent's account + oversight dashboard
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/child" element={<ChildChat />} />
        <Route path="/parent" element={<ParentDashboard />} />
        <Route path="/moderator" element={<ModeratorDashboard />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </BrowserRouter>
  )
}
