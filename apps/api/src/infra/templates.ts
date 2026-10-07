/** Email templates in English and Arabic (RTL). All interpolated values are HTML-escaped. */
export type Locale = 'en' | 'ar';
export type TemplateId =
  | 'magic_link'
  | 'user_invite'
  | 'interview_invitation'
  | 'interviewer_assignment'
  | 'interview_reminder'
  | 'interview_rescheduled'
  | 'interview_cancelled'
  | 'feedback_reminder'
  | 'decision_recorded';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Vars = Record<string, string | number | undefined>;
type Def = { subject: (v: Vars) => string; lines: (v: Vars) => string[]; cta?: (v: Vars) => { label: string; url: string } };

const T: Record<Locale, Record<TemplateId, Def>> = {
  en: {
    magic_link: { subject: () => 'Your EVIDA sign-in link', lines: () => ['Use the button below to sign in. The link expires in 15 minutes and can be used once.'], cta: (v) => ({ label: 'Sign in', url: String(v.url) }) },
    user_invite: { subject: (v) => `You have been invited to ${v.org} on EVIDA`, lines: (v) => [`${v.inviter} invited you to join ${v.org}.`, 'Set up your access using the link below (valid for 72 hours).'], cta: (v) => ({ label: 'Accept invitation', url: String(v.url) }) },
    interview_invitation: {
      subject: (v) => `Interview invitation: ${v.job}`,
      lines: (v) => [`Dear ${v.candidate},`, `You are invited to a ${v.duration}-minute ${v.stage} interview for the ${v.job} role at ${v.org}.`, `Time: ${v.when}`, 'Before the interview you will review how your data is used, give or decline consent, and test your camera and microphone.'],
      cta: (v) => ({ label: 'Open interview page', url: String(v.url) }),
    },
    interviewer_assignment: { subject: (v) => `Interview assigned: ${v.candidate} — ${v.job}`, lines: (v) => [`You are on the panel for ${v.candidate} (${v.stage}).`, `Time: ${v.when}`, 'Review the interview guide and competencies before you start.'], cta: (v) => ({ label: 'Open interview', url: String(v.url) }) },
    interview_reminder: { subject: (v) => `Reminder: interview at ${v.when}`, lines: (v) => [`This is a reminder of your ${v.stage} interview for ${v.job}.`], cta: (v) => ({ label: 'Open interview page', url: String(v.url) }) },
    interview_rescheduled: { subject: (v) => `Interview rescheduled: ${v.job}`, lines: (v) => [`Your interview has moved to ${v.when}.`], cta: (v) => ({ label: 'Open interview page', url: String(v.url) }) },
    interview_cancelled: { subject: (v) => `Interview cancelled: ${v.job}`, lines: () => ['Your interview has been cancelled. The hiring team will contact you about next steps.'] },
    feedback_reminder: { subject: (v) => `Scorecard pending: ${v.candidate}`, lines: (v) => [`Your scorecard for ${v.candidate} (${v.job}) has not been submitted.`, 'Timely, evidence-based feedback keeps the process fair.'], cta: (v) => ({ label: 'Complete scorecard', url: String(v.url) }) },
    decision_recorded: { subject: (v) => `Decision recorded: ${v.candidate}`, lines: (v) => [`${v.decider} recorded the decision "${v.outcome}" for ${v.candidate} (${v.job}).`], cta: (v) => ({ label: 'View decision', url: String(v.url) }) },
  },
  ar: {
    magic_link: { subject: () => 'رابط تسجيل الدخول إلى EVIDA', lines: () => ['استخدم الزر أدناه لتسجيل الدخول. تنتهي صلاحية الرابط خلال 15 دقيقة ويُستخدم مرة واحدة.'], cta: (v) => ({ label: 'تسجيل الدخول', url: String(v.url) }) },
    user_invite: { subject: (v) => `دعوة للانضمام إلى ${v.org} على EVIDA`, lines: (v) => [`دعاك ${v.inviter} للانضمام إلى ${v.org}.`, 'فعّل حسابك من خلال الرابط أدناه (صالح لمدة 72 ساعة).'], cta: (v) => ({ label: 'قبول الدعوة', url: String(v.url) }) },
    interview_invitation: {
      subject: (v) => `دعوة لمقابلة: ${v.job}`,
      lines: (v) => [`عزيزي/عزيزتي ${v.candidate}،`, `ندعوك لمقابلة (${v.stage}) مدتها ${v.duration} دقيقة لوظيفة ${v.job} لدى ${v.org}.`, `الموعد: ${v.when}`, 'قبل المقابلة ستطّلع على كيفية استخدام بياناتك، وتمنح الموافقة أو ترفضها، وتختبر الكاميرا والميكروفون.'],
      cta: (v) => ({ label: 'فتح صفحة المقابلة', url: String(v.url) }),
    },
    interviewer_assignment: { subject: (v) => `مقابلة مُسندة: ${v.candidate} — ${v.job}`, lines: (v) => [`أنت ضمن لجنة مقابلة ${v.candidate} (${v.stage}).`, `الموعد: ${v.when}`, 'راجع دليل المقابلة والكفاءات قبل البدء.'], cta: (v) => ({ label: 'فتح المقابلة', url: String(v.url) }) },
    interview_reminder: { subject: (v) => `تذكير: مقابلة في ${v.when}`, lines: (v) => [`تذكير بمقابلة ${v.stage} لوظيفة ${v.job}.`], cta: (v) => ({ label: 'فتح صفحة المقابلة', url: String(v.url) }) },
    interview_rescheduled: { subject: (v) => `تم تغيير موعد المقابلة: ${v.job}`, lines: (v) => [`الموعد الجديد: ${v.when}.`], cta: (v) => ({ label: 'فتح صفحة المقابلة', url: String(v.url) }) },
    interview_cancelled: { subject: (v) => `إلغاء المقابلة: ${v.job}`, lines: () => ['تم إلغاء المقابلة. سيتواصل معك فريق التوظيف بشأن الخطوات التالية.'] },
    feedback_reminder: { subject: (v) => `بطاقة تقييم معلّقة: ${v.candidate}`, lines: (v) => [`لم تُرسل بطاقة تقييم ${v.candidate} (${v.job}) بعد.`], cta: (v) => ({ label: 'إكمال التقييم', url: String(v.url) }) },
    decision_recorded: { subject: (v) => `تم تسجيل القرار: ${v.candidate}`, lines: (v) => [`سجّل ${v.decider} القرار "${v.outcome}" للمرشح ${v.candidate} (${v.job}).`], cta: (v) => ({ label: 'عرض القرار', url: String(v.url) }) },
  },
};

export function renderEmail(id: TemplateId, locale: Locale, vars: Vars) {
  const def = (T[locale] ?? T.en)[id];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const cta = def.cta?.(vars);
  const body = def.lines(vars).map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('');
  const button = cta
    ? `<p style="margin:24px 0"><a href="${esc(cta.url)}" style="background:#8E2A2E;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="font-family:Segoe UI,Arial,sans-serif;color:#2B1D1F;background:#F7F1F1;padding:24px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #E8DADA">
<div style="font-weight:700;letter-spacing:.12em;color:#8E2A2E;margin-bottom:24px">EVIDA</div>${body}${button}
<p style="font-size:12px;color:#6E5A5C;margin-top:32px">Every interview. Structured. Evidenced. Decided.</p></div></body></html>`;
  const text = [...def.lines(vars), cta ? `${cta.label}: ${cta.url}` : ''].join('\n\n');
  return { subject: def.subject(vars), html, text };
}
