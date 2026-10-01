"use client";

interface Section {
  id: string;
  label: string;
}

interface SectionJumpProps {
  sections: Section[];
}

export function SectionJump({ sections }: SectionJumpProps) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Reset to placeholder
    e.target.value = "";
  }

  return (
    <div className="section-jump-wrap">
      <select
        className="section-jump-select"
        defaultValue=""
        onChange={handleChange}
        aria-label="Jump to section"
      >
        <option value="" disabled>
          ↓ Jump to section…
        </option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
