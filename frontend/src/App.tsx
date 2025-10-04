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
            <a href="/" className="text-xl font-semibold">EcoShield</a>
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
