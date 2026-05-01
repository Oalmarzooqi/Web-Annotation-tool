import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/shell/Shell";
import { ProjectsPage } from "./pages/projects/ProjectsPage";
import { NewProjectPage } from "./pages/projects/NewProjectPage";
import { ProjectViewPage } from "./pages/projects/ProjectViewPage";
import { EditProjectPage } from "./pages/projects/EditProjectPage";
import { ProjectAnnotatePage } from "./pages/annotate/ProjectAnnotatePage";
import { AnnotateLandingPage } from "./pages/annotate/AnnotateLandingPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<NewProjectPage />} />
        <Route path="/projects/:id" element={<ProjectViewPage />} />
        <Route path="/projects/:id/edit" element={<EditProjectPage />} />
        <Route path="/projects/:id/annotate" element={<ProjectAnnotatePage />} />
        <Route path="/annotate" element={<AnnotateLandingPage />} />
      </Route>
    </Routes>
  );
}
