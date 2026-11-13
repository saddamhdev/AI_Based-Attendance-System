/** Client-side checks mirroring StudentPortal.validateRegistration, for immediate field feedback. */
export type RegistrationFields = {
  name: string; roll: string; email: string; username: string; password: string; confirm: string;
  department: string; batch: string;
};

export function validateRegistration(fields: RegistrationFields, options: { requirePassword: boolean; checkUsername: boolean }) {
  const errors: Partial<Record<keyof RegistrationFields, string>> = {};
  if (!fields.name.trim()) errors.name = 'Enter your full name.';
  else if (fields.name.trim().length > 160) errors.name = 'Use at most 160 characters.';
  if (!fields.roll.trim()) errors.roll = 'Enter your roll / student ID.';
  else if (fields.roll.trim().length > 64) errors.roll = 'Use at most 64 characters.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) errors.email = 'Enter a valid email address.';
  if (options.checkUsername && !/^[A-Za-z0-9._-]{3,64}$/.test(fields.username.trim())) {
    errors.username = '3–64 letters, numbers, dots, dashes, or underscores.';
  }
  if (options.requirePassword || fields.password) {
    if (fields.password.length < 12 || fields.password.length > 128) errors.password = 'Use 12–128 characters.';
    else if (fields.password !== fields.confirm) errors.confirm = 'Passwords do not match.';
  }
  if (fields.department.trim().length > 120) errors.department = 'Use at most 120 characters.';
  if (fields.batch.trim().length > 80) errors.batch = 'Use at most 80 characters.';
  return errors;
}
