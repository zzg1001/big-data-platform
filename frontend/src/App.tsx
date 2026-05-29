import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import MainLayout from './layouts/MainLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import DataSources from './pages/DataSources'
import FileManager from './pages/FileManager'
import DataSync from './pages/DataSync'
import FieldTemplates from './pages/FieldTemplates'
import DataExplorer from './pages/DataExplorer'
import EtlTasks from './pages/EtlTasks'
import Scheduler from './pages/Scheduler'
import Admin from './pages/Admin'
import DwLayers from './pages/DwLayers'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <MainLayout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="datasources" element={<DataSources />} />
        <Route path="files" element={<FileManager />} />
        <Route path="data-sync" element={<DataSync />} />
        <Route path="field-templates" element={<FieldTemplates />} />
        <Route path="data-explorer" element={<DataExplorer />} />
        <Route path="etl-tasks" element={<EtlTasks />} />
        <Route path="scheduler" element={<Scheduler />} />
        <Route path="dw-layers" element={<DwLayers />} />
        <Route path="admin" element={<Admin />} />
      </Route>
    </Routes>
  )
}

export default App
