import {
  retry,
  handleAll,
  ExponentialBackoff,
  circuitBreaker,
  wrap,
  ConsecutiveBreaker,
  IPolicy,
} from "cockatiel";

export function makeToolPolicy(): IPolicy {
  return wrap(
    circuitBreaker(handleAll, {
      halfOpenAfter: 8_000,
      breaker: new ConsecutiveBreaker(3),
    }),
    retry(handleAll, {
      maxAttempts: 3,
      backoff: new ExponentialBackoff({ initialDelay: 200, maxDelay: 2400 }),
    }),
  );
}

export function makeLLMPolicy(): IPolicy {
  return retry(handleAll, {
    maxAttempts: 4,
    backoff: new ExponentialBackoff({ initialDelay: 400, maxDelay: 4000 }),
  });
}
