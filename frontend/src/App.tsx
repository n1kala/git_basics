import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <header className="border-b border-gray-200 dark:border-gray-800">
          <div className="container py-4 flex items-center justify-between">
            <a href="/" className="text-xl font-semibold flex items-center gap-2">
              <span>EcoShield</span>
            </a>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <img src="https://upload.wikimedia.org/wikipedia/commons/e/e5/NASA_logo.svg" alt="NASA" className="h-5 w-5" />
              <span>Powered by NASA POWER and FIRMS APIs</span>
            </div>
          </div>
        </header>
        <main className="container py-6">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
