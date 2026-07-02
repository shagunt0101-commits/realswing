import { useWorkspace } from "../stores/workspace";
import WorkspacePanel from "./WorkspacePanel";

const C = { bg: "#080E1C", border: "#1A2E52", accent: "#00D4FF", dim: "#4A6080" };

export default function WorkspaceLayout() {
    const panels = useWorkspace(s => s.panels);
    const addPanel = useWorkspace(s => s.addPanel);
    const resetLayout = useWorkspace(s => s.resetLayout);

    return (
        <div>
            {/* Workspace controls */}
            <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 8, padding: "0 4px",
            }}>
                <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={addPanel} disabled={panels.length >= 9}
                        style={{
                            background: `${C.accent}12`, border: `1px solid ${C.accent}44`,
                            color: C.accent, borderRadius: 4, padding: "4px 12px",
                            cursor: "pointer", fontSize: 11,
                            opacity: panels.length >= 9 ? 0.4 : 1,
                        }}>
                        + Add Chart
                    </button>
                    <button onClick={resetLayout}
                        style={{
                            background: "none", border: `1px solid ${C.border}`,
                            color: C.dim, borderRadius: 4, padding: "4px 12px",
                            cursor: "pointer", fontSize: 11,
                        }}>
                        Reset Layout
                    </button>
                </div>
                <span style={{ color: C.dim, fontSize: 10 }}>
                    {panels.length}/9 charts
                </span>
            </div>

            {/* Chart grid */}
            <div style={{
                display: "grid",
                gridTemplateColumns: panels.length === 1 ? "1fr" : "1fr 1fr",
                gap: 8,
            }}>
                {panels.map(id => (
                    <WorkspacePanel key={id} chartId={id} />
                ))}
            </div>
        </div>
    );
}
