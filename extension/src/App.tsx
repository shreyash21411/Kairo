import { useEffect, useState } from "react";
import MemoryToggle from "./components/MemoryToggle";
import Continuity from "./continuity/Continuity";
import "./App.css";

function App() {
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");

  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(
        ["memoryEnabled", "selectedProject"],
        (result) => {
          if (typeof result.memoryEnabled === "boolean") {
            setMemoryEnabled(result.memoryEnabled);
          }
          if (typeof result.selectedProject === "string") {
            setSelectedProject(result.selectedProject);
          }
        }
      );
    }
  }, []);

  const handleMemoryChange = (enabled: boolean) => {
    setMemoryEnabled(enabled);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ memoryEnabled: enabled });
    }
  };

  const handleProjectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = event.target.value;
    setSelectedProject(projectId);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ selectedProject: projectId });
    }
  };

  return (
    <div className="vz-app">
      {/* Top Header */}
      <header className="vz-header">
        <div className="vz-brand">
          <div className="vz-logo-mark">V</div>
          <div className="vz-brand-text">
            <span className="vz-wordmark">VOIDZONE</span>
            <span className="vz-tagline">CONTINUITY</span>
          </div>
        </div>

        <div className="vz-header-actions">
          <span
            className={`vz-status-pill ${
              memoryEnabled ? "vz-status-live" : "vz-status-standby"
            }`}
          >
            <span className="vz-status-dot" />
            {memoryEnabled ? "CAPTURE ACTIVE" : "CAPTURE PAUSED"}
          </span>
        </div>
      </header>

      {/* Control Strip */}
      <section className="vz-controls-bar">
        <div className="vz-control-item">
          <label className="vz-control-label" htmlFor="vz-project-select">
            Project
          </label>
          <select
            id="vz-project-select"
            className="vz-select"
            value={selectedProject}
            onChange={handleProjectChange}
          >
            <option value="">Default Project</option>
            <option value="ai-job-agent">AI Job Agent</option>
            <option value="test-project">Test Project</option>
          </select>
        </div>

        <div className="vz-control-item vz-control-toggle">
          <span className="vz-control-label">Continuous Capture</span>
          <MemoryToggle
            enabled={memoryEnabled}
            onChange={handleMemoryChange}
          />
        </div>
      </section>

      {/* Main Continuity Interface */}
      <main className="vz-main">
        <Continuity
          memoryEnabled={memoryEnabled}
          selectedProject={selectedProject}
        />
      </main>

      {/* Footer */}
      <footer className="vz-footer">
        <span>VOIDZONE CONTINUITY · META AI DEVELOPER HACKATHON 2026</span>
      </footer>
    </div>
  );
}

export default App;
