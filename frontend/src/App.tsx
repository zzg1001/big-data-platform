import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import MainLayout from './layouts/MainLayout'
import Login from './pages/Login'
import Portal from './pages/Portal'
import TagSystem from './pages/TagSystem'
import TagLayouts from './pages/TagLayouts'
import Scheduler from './pages/Scheduler'
import Dashboard from './pages/Dashboard'
import DataSources from './pages/DataSources'
import DataSync from './pages/DataSync'
import DataSyncHome from './pages/DataSyncHome'
import DataSyncScript from './pages/DataSyncScript'
import DataSyncDataX from './pages/DataSyncDataX'
import FieldTemplates from './pages/FieldTemplates'
import DataExplorer from './pages/DataExplorer'
import EtlTasks from './pages/EtlTasks'
import Admin from './pages/Admin'
import DwLayers from './pages/DwLayers'
import DataService from './pages/DataService'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  const location = useLocation()
  if (isAuthenticated) {
    return <>{children}</>
  }
  // 未登录时记录当前页面，登录成功后回到该页面
  const redirect = encodeURIComponent(location.pathname + location.search + location.hash)
  return <Navigate to={`/login?redirect=${redirect}`} replace />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Portal />
          </PrivateRoute>
        }
      />
      <Route
        path="/tags"
        element={
          <PrivateRoute>
            <TagSystem />
          </PrivateRoute>
        }
      />
      <Route
        path="/tag-layouts"
        element={
          <PrivateRoute>
            <TagLayouts />
          </PrivateRoute>
        }
      />
      <Route
        path="/scheduler"
        element={
          <PrivateRoute>
            <Scheduler />
          </PrivateRoute>
        }
      />
      <Route
        path="/data-service"
        element={
          <PrivateRoute>
            <DataService />
          </PrivateRoute>
        }
      />
      <Route
        path="/bigdata"
        element={
          <PrivateRoute>
            <MainLayout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="datasources" element={<DataSources />} />
        <Route path="data-sync" element={<DataSyncHome />} />
        <Route path="data-sync/db" element={<DataSync />} />
        <Route path="data-sync/script" element={<DataSyncScript />} />
        <Route path="data-sync/datax" element={<DataSyncDataX />} />
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
