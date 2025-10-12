// Placeholder password utilities (argon2 not installed)
export const hashPassword = async (password: string): Promise<string> => {
  // TODO: Install argon2 package and implement proper hashing
  return `hash_${password}`;
};

export const verifyPassword = async (hash: string, password: string): Promise<boolean> => {
  // TODO: Install argon2 package and implement proper verification
  return hash === `hash_${password}`;
};
