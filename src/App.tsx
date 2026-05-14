import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import Home from "./pages/Home";
import Auth from "./pages/Auth";
import Browse from "./pages/Browse";
import ProjectDetail from "./pages/ProjectDetail";
import MapPage from "./pages/MapPage";
import Compare from "./pages/Compare";
import Analytics from "./pages/Analytics";
import ProjectRatings from "./pages/ProjectRatings";
import Dashboard from "./pages/Dashboard";
import SubmitProject from "./pages/SubmitProject";
import Admin from "./pages/Admin";
import AdminGuide from "./pages/AdminGuide";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/projects" element={<Browse />} />
            <Route path="/projects/:slug" element={<ProjectDetail />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/analytics/ratings" element={<ProjectRatings />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/submit" element={<SubmitProject />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/guide" element={<AdminGuide />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
