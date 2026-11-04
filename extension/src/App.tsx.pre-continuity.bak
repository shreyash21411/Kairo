import { useEffect, useState } from "react";
import MemoryToggle from "./components/MemoryToggle";
import "./App.css";

function App() {
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");

  useEffect(() => {
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
  }, []);

  const handleMemoryChange = (enabled: boolean) => {
    setMemoryEnabled(enabled);

    chrome.storage.local.set({
      memoryEnabled: enabled,
    });
  };

  const handleProjectChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const projectId = event.target.value;

    setSelectedProject(projectId);

    chrome.storage.local.set({
      selectedProject: projectId,
    });
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          🧠
        </div>

        <div className="header-content">
          <h1>AI Memory</h1>
          <p>Persistent Project Memory</p>
        </div>
      </header>

      <main className="main-content">

        <section className="memory-section">
          <div className="memory-info">
            <h2>Memory</h2>

            <p>
              {memoryEnabled
                ? "Project memory is active."
                : "Project memory is currently off."}
            </p>
          </div>

          <MemoryToggle
            enabled={memoryEnabled}
            onChange={handleMemoryChange}
          />
        </section>

        <section className="section">
          <div className="section-header">
            <h2>Project</h2>

            <span className="section-description">
              Select the project whose memory you want to use.
            </span>
          </div>

          <select
            className="select"
            value={selectedProject}
            onChange={handleProjectChange}
          >
            <option value="">
              Select Project
            </option>

            <option value="ai-job-agent">
              AI Job Agent
            </option>

            <option value="test-project">
              Test Project
            </option>
          </select>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>Connected Platform</h2>

            <span className="section-description">
              Choose the AI platform you are using.
            </span>
          </div>

          <select className="select">
            <option value="chatgpt">
              ChatGPT
            </option>
          </select>
        </section>

        <div
          className={`status ${memoryEnabled
              ? "status-active"
              : "status-inactive"
            }`}
        >
          <span className="status-indicator">
            {memoryEnabled ? "●" : "○"}
          </span>

          <span>
            {memoryEnabled
              ? "Memory is active"
              : "Memory is off"}
          </span>
        </div>

      </main>
    </div>
  );
}

export default App;