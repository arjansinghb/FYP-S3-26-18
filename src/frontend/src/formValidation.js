// The browser's own "Fill out this field" tooltip (native `required`
// constraint validation) can't be styled or reworded — it reads as
// unfinished/default browser chrome next to the rest of the app's own
// error messages ("Write a few words first.", "Pick a star rating
// first.", etc.), and was flagged directly against the consent form's
// password field. Every form with a required input now pairs `noValidate`
// on the <form> (which turns off ALL of the browser's own validation UI,
// not just `required` — minLength/type=email included) with a check here,
// funneled into the same inline `error` state / `.error` <p> every form
// already renders on a failed submit.
export function firstMissingField(fields) {
  for (const [value, label] of fields) {
    if (value === undefined || value === null || !String(value).trim()) {
      return `${label} is required.`
    }
  }
  return null
}
