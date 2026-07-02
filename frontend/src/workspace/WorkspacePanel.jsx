import LiveChart from "../chart/LiveChart";
import ChartToolbar from "../chart/ChartToolbar";

const C = { panel: "#0D1729", border: "#1A2E52" };

export default function WorkspacePanel({ chartId }) {
    return (
        <div style={{
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 10, overflow: "hidden",
            display: "flex", flexDirection: "column",
            minHeight: 320,
        }}>
            <ChartToolbar chartId={chartId} />
            <div style={{ flex: 1, minHeight: 280 }}>
                <LiveChart chartId={chartId} />
            </div>
        </div>
    );
}
