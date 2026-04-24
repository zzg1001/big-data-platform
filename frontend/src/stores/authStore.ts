import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '../services/api'

interface User {
  id: number
  username: string
  email: string
  fullName?: string
  isActive: boolean
  isSuperuser: boolean
}

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  refreshAccessToken: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      login: async (username: string, password: string) => {
        const response = await api.post('/api/v1/auth/login', { username, password })
        const { access_token, refresh_token } = response.data

        // Set tokens in api instance
        api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`

        // Fetch user info
        const userResponse = await api.get('/api/v1/users/me')

        set({
          accessToken: access_token,
          refreshToken: refresh_token,
          user: {
            id: userResponse.data.id,
            username: userResponse.data.username,
            email: userResponse.data.email,
            fullName: userResponse.data.full_name,
            isActive: userResponse.data.is_active,
            isSuperuser: userResponse.data.is_superuser,
          },
          isAuthenticated: true,
        })
      },

      logout: () => {
        delete api.defaults.headers.common['Authorization']
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        })
      },

      refreshAccessToken: async () => {
        const { refreshToken } = get()
        if (!refreshToken) {
          get().logout()
          return
        }

        try {
          const response = await api.post('/api/v1/auth/refresh', {
            refresh_token: refreshToken,
          })
          const { access_token, refresh_token } = response.data

          api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`

          set({
            accessToken: access_token,
            refreshToken: refresh_token,
          })
        } catch {
          get().logout()
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

// Set token on app load if exists
const state = useAuthStore.getState()
if (state.accessToken) {
  api.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`
}
