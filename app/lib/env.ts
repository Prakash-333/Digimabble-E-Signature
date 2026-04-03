export const validateEnv = () => {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "UPLOADTHING_SECRET",
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    return {
      isValid: false,
      missing,
    };
  }

  return {
    isValid: true,
    missing: [],
  };
};

export const IS_SUPABASE_CONFIGURED = 
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && 
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
