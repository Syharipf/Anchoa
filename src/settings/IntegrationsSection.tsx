import { GithubSection } from "./GithubSection";
import { EmailSection } from "./EmailSection";
import { CalendarSection } from "./CalendarSection";
import { BrowserSection } from "./BrowserSection";
export function IntegrationsSection({
  onChanged,
}: Readonly<{ onChanged: () => void }>) {
  return (
    <div className="flex flex-col gap-4">
      <GithubSection onChanged={onChanged} />
      <EmailSection onChanged={onChanged} />
      <CalendarSection onChanged={onChanged} />
      <BrowserSection onChanged={onChanged} />
    </div>
  );
}
