try {
    if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
    }
} catch (error) {
    console.error('Resend API initialization failed', error);
}