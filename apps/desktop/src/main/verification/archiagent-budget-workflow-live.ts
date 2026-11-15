import { app } from 'electron';

// Historical capacity-admission acceptance is retired. Never modify projects or policy to run it.
void app.whenReady().then(() => {
  console.error(
    'Historical capacity-admission driver retired; see docs/resource-execution-policy.md',
  );
  app.exit(1);
});
