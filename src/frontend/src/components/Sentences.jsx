// Running text that holds more than one sentence, shown one sentence per line.
// Letting a two-sentence note wrap on its own leaves the last word or two alone on a second line ("... not in Mia's
// app." / "it."); starting each sentence on a new line keeps the breaks where the reader expects them, in every browser.
export default function Sentences({ text }) {
  const parts = String(text ?? '').split(/(?<=[.!?]["”’']?)\s+(?=["“A-Z])/)
  return parts.map((s, i) => <span key={i} className="sentence">{s}</span>)
}
