import { toast } from "sonner";

type ToastPromiseMessages<T> = {
  loading: string;
  success: string | ((data: T) => string);
  error: string | ((error: unknown) => string);
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Có lỗi xảy ra. Vui lòng thử lại.";
};

export const toastService = {
  success(message: string) {
    toast.success(message);
  },

  error(message: string) {
    toast.error(message);
  },

  info(message: string) {
    toast.info(message);
  },

  warning(message: string) {
    toast.warning(message);
  },

  promise<T>(
    promise: Promise<T>,
    messages: ToastPromiseMessages<T>,
  ): Promise<T> {
    const toastPromise = toast.promise(promise, {
      loading: messages.loading,
      success: (data) =>
        typeof messages.success === "function"
          ? messages.success(data)
          : messages.success,
      error: (error) =>
        typeof messages.error === "function"
          ? messages.error(error)
          : messages.error,
    });

    if (
      toastPromise &&
      typeof toastPromise === "object" &&
      "unwrap" in toastPromise &&
      typeof toastPromise.unwrap === "function"
    ) {
      return toastPromise.unwrap();
    }

    return promise;
  },

  getErrorMessage(error: unknown) {
    return toErrorMessage(error);
  },
};
