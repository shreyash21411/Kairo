interface MemoryToggleProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
}

function MemoryToggle({
    enabled,
    onChange,
}: MemoryToggleProps) {
    return (
        <button
            type="button"
            className={`halo-toggle ${enabled ? "is-on" : ""}`}
            onClick={() => onChange(!enabled)}
            aria-pressed={enabled}
            aria-label="Toggle project memory"
        >
            <span className="halo-toggle-track">
                <span className="halo-toggle-glow" />
                <span className="halo-toggle-knob">
                    <span className="halo-toggle-core" />
                </span>
            </span>


        </button>
    );
}

export default MemoryToggle;