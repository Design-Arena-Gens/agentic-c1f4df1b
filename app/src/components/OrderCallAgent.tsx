"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Order, orders as initialOrders } from "@/data/orders";

type Speaker = "agent" | "customer" | "system";

type ConversationEntry = {
  speaker: Speaker;
  message: string;
  timestamp: string;
  awaitingResponse?: boolean;
};

type CallState =
  | "idle"
  | "dialing"
  | "speaking"
  | "awaiting_response"
  | "resolved"
  | "muted";

type CallOutcome = "confirmed" | "rescheduled" | "cancelled" | "needs_support";

const ORDER_STATUS_META: Record<
  Order["status"],
  { label: string; classes: string }
> = {
  pending: {
    label: "Pending confirmation",
    classes:
      "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-200",
  },
  confirmed: {
    label: "Confirmed",
    classes:
      "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-100",
  },
  requires_followup: {
    label: "Requires follow-up",
    classes:
      "bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-500/20 dark:text-sky-100",
  },
  cancelled: {
    label: "Cancelled",
    classes:
      "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/20 dark:text-rose-100",
  },
};

const RESCHEDULE_OPTIONS = [
  "Today, 7PM - 9PM",
  "Tomorrow, 9AM - 12PM",
  "Tomorrow, 2PM - 5PM",
  "Saturday, 11AM - 1PM",
];

const formatINR = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

const timestamp = () => new Date().toISOString();

const isBrowser =
  typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

const useSpeechSynthesis = () => {
  const supported = isBrowser;
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    return () => {
      if (isBrowser) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!isBrowser) {
        onEnd?.();
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-IN";
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 0.9;

      utterance.onend = () => {
        onEnd?.();
      };

      utterance.onerror = () => {
        onEnd?.();
      };

      activeUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    []
  );

  const stop = useCallback(() => {
    if (!isBrowser) return;
    window.speechSynthesis.cancel();
    activeUtteranceRef.current = null;
  }, []);

  return { supported, speak, stop };
};

export const OrderCallAgent = () => {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(
    initialOrders[0]?.id ?? null
  );
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callOutcome, setCallOutcome] = useState<CallOutcome | null>(null);
  const [rescheduleSlot, setRescheduleSlot] = useState<string>("");
  const [agentMuted, setAgentMuted] = useState<boolean>(false);

  const timeoutsRef = useRef<number[]>([]);
  const { speak, stop, supported } = useSpeechSynthesis();

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const resetCall = useCallback(() => {
    timeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    timeoutsRef.current = [];
    stop();
    setConversation([]);
    setCallState("idle");
    setCallOutcome(null);
    setRescheduleSlot("");
  }, [stop]);

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      timeoutsRef.current = [];
    };
  }, []);

  const addMessage = useCallback((entry: ConversationEntry) => {
    setConversation((prev) => [...prev, entry]);
  }, []);

  const scheduleAgentLine = useCallback(
    (
      text: string,
      delay: number,
      options: { awaitingResponse?: boolean; markResolved?: boolean } = {}
    ) => {
      const timeoutId = window.setTimeout(() => {
        const entry: ConversationEntry = {
          speaker: "agent",
          message: text,
          timestamp: timestamp(),
          awaitingResponse: options.awaitingResponse,
        };
        addMessage(entry);
        setCallState("speaking");

        speak(text, () => {
          if (options.markResolved) {
            setCallState("resolved");
          } else if (options.awaitingResponse) {
            setCallState("awaiting_response");
          } else {
            setCallState("speaking");
          }
        });
      }, delay);
      timeoutsRef.current.push(timeoutId);
    },
    [addMessage, speak]
  );

  const startCall = useCallback(() => {
    if (!selectedOrder) return;
    resetCall();
    setCallState("dialing");

    addMessage({
      speaker: "system",
      message: `Dialing ${selectedOrder.phoneNumber}…`,
      timestamp: timestamp(),
    });

    const introDelay = 1200;

    scheduleAgentLine(
      `Hello ${selectedOrder.customerName}, this is the Flipkart order validation desk. I'm calling to confirm your order ${selectedOrder.id} for ${formatINR(
        selectedOrder.total
      )}.`,
      introDelay,
      { awaitingResponse: false }
    );

    scheduleAgentLine(
      `It includes ${selectedOrder.items
        .map(
          (item) =>
            `${item.quantity} ${item.name}${item.quantity > 1 ? "s" : ""}`
        )
        .join(", ")} with ${selectedOrder.paymentMethod.toLowerCase()}. Is everything correct so we can schedule delivery ${selectedOrder.deliverySlot}?`,
      introDelay + 2200,
      { awaitingResponse: true }
    );
  }, [addMessage, resetCall, scheduleAgentLine, selectedOrder]);

  const completeCall = useCallback(
    (outcome: CallOutcome, orderUpdater: (order: Order) => Order) => {
      if (!selectedOrder) return;

      setOrders((prev) =>
        prev.map((order) =>
          order.id === selectedOrder.id ? orderUpdater(order) : order
        )
      );
      setCallOutcome(outcome);
      setCallState("resolved");
    },
    [selectedOrder]
  );

  const handleCustomerResponse = useCallback(
    (type: "confirm" | "reschedule" | "cancel" | "query") => {
      if (!selectedOrder) return;

      const customerLines: Record<typeof type, string> = {
        confirm: "Yes, please go ahead.",
        reschedule: "Could we deliver in a different slot?",
        cancel: "I want to cancel this order.",
        query: "Can you tell me the payment details once more?",
      };

      addMessage({
        speaker: "customer",
        message: customerLines[type],
        timestamp: timestamp(),
      });

      if (type === "confirm") {
        scheduleAgentLine(
          "Perfect, I will confirm the order and send you the delivery updates on SMS right away.",
          400,
          { awaitingResponse: false }
        );
        scheduleAgentLine(
          "Thank you for shopping with Flipkart. Have a great day!",
          2000,
          { awaitingResponse: false, markResolved: true }
        );

        const updater = (order: Order): Order => ({
          ...order,
          status: "confirmed",
        });

        const timeoutId = window.setTimeout(() => {
          completeCall("confirmed", updater);
        }, 2500);
        timeoutsRef.current.push(timeoutId);
      }

      if (type === "reschedule") {
        setCallState("awaiting_response");
        setCallOutcome("rescheduled");
        setRescheduleSlot("");
        scheduleAgentLine(
          "Sure, I can help with that. I have a few delivery slots available, please pick the one that works best for you.",
          500,
          { awaitingResponse: true }
        );
      }

      if (type === "cancel") {
        scheduleAgentLine(
          "I understand. I will cancel the order right away and send a confirmation SMS. Thank you for your time.",
          700,
          { awaitingResponse: false, markResolved: true }
        );

        const updater = (order: Order): Order => ({
          ...order,
          status: "cancelled",
        });

        const timeoutId = window.setTimeout(() => {
          completeCall("cancelled", updater);
        }, 1400);
        timeoutsRef.current.push(timeoutId);
      }

      if (type === "query") {
        scheduleAgentLine(
          `This order is ${formatINR(
            selectedOrder.total
          )} with ${selectedOrder.paymentMethod.toLowerCase()}. Would you like to proceed with the same plan?`,
          700,
          { awaitingResponse: true }
        );
      }
    },
    [addMessage, completeCall, scheduleAgentLine, selectedOrder]
  );

  const handleRescheduleSelection = useCallback(
    (slot: string) => {
      if (!selectedOrder) return;

      setRescheduleSlot(slot);
      addMessage({
        speaker: "customer",
        message: `Let's move it to ${slot}.`,
        timestamp: timestamp(),
      });

      scheduleAgentLine(
        `Done, I have rescheduled your delivery to ${slot}. You will receive a confirmation SMS shortly.`,
        500,
        { awaitingResponse: false }
      );

      scheduleAgentLine("Thanks for confirming. Have a great day!", 2000, {
        awaitingResponse: false,
        markResolved: true,
      });

      const updater = (order: Order): Order => ({
        ...order,
        status: "confirmed",
        deliverySlot: slot,
      });

      const timeoutId = window.setTimeout(() => {
        completeCall("rescheduled", updater);
      }, 2300);
      timeoutsRef.current.push(timeoutId);
    },
    [addMessage, completeCall, scheduleAgentLine, selectedOrder]
  );

  const escalateToSupport = useCallback(() => {
    if (!selectedOrder) return;
    addMessage({
      speaker: "agent",
      message:
        "I'll escalate this to a senior support specialist who will call you back within the next hour.",
      timestamp: timestamp(),
    });
    completeCall("needs_support", (order) => ({
      ...order,
      status: "requires_followup",
    }));
  }, [addMessage, completeCall, selectedOrder]);

  const toggleMute = useCallback(() => {
    setAgentMuted((prev) => {
      const next = !prev;
      if (next) {
        stop();
        setCallState("muted");
      } else {
        setCallState(conversation.length ? "awaiting_response" : "dialing");
      }
      return next;
    });
  }, [conversation.length, stop]);

  useEffect(() => {
    if (!agentMuted) return;
    stop();
  }, [agentMuted, stop]);

  const callInFlight = callState !== "idle" && callState !== "resolved";

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <aside className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-sm backdrop-blur-lg dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Active Orders
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Pick an order and launch the automated confirmation call.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {orders.map((order) => {
              const statusMeta = ORDER_STATUS_META[order.status];
              const isSelected = order.id === selectedOrderId;
              return (
                <button
                  key={order.id}
                  type="button"
                  className={`rounded-2xl border p-4 text-left transition-colors ${
                    isSelected
                      ? "border-purple-500 bg-gradient-to-r from-purple-500/10 via-purple-500/5 to-transparent dark:border-purple-400/80"
                      : "border-zinc-200 hover:border-purple-400 hover:bg-purple-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  }`}
                  onClick={() => {
                    if (callInFlight) return;
                    setSelectedOrderId(order.id);
                    resetCall();
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {order.customerName}
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${statusMeta.classes}`}
                    >
                      {statusMeta.label}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    <div>{order.id}</div>
                    <div className="mt-1 font-medium text-zinc-800 dark:text-zinc-200">
                      {formatINR(order.total)}
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {order.items.slice(0, 3).map((item) => (
                        <span
                          key={`${order.id}-${item.name}`}
                          className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800/80"
                        >
                          {item.quantity}× {item.name}
                        </span>
                      ))}
                      {order.items.length > 3 && (
                        <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800/80">
                          +{order.items.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="rounded-3xl border border-zinc-200 bg-white/90 p-6 shadow-sm backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/70">
        {selectedOrder ? (
          <div className="flex h-full flex-col gap-6">
            <header className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {selectedOrder.customerName}
                  </h1>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {selectedOrder.phoneNumber}
                  </p>
                </div>
                <div className="rounded-2xl border border-purple-200 bg-purple-100 px-4 py-2 text-sm font-semibold text-purple-700 dark:border-purple-500/40 dark:bg-purple-500/10 dark:text-purple-100">
                  Flipkart Voice Agent
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                <div className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
                  {selectedOrder.paymentMethod}
                </div>
                <div className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
                  Delivery: {selectedOrder.deliverySlot}
                </div>
                <div className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
                  Total: {formatINR(selectedOrder.total)}
                </div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                <div className="font-semibold text-zinc-800 dark:text-zinc-100">
                  Delivery address
                </div>
                <div>{selectedOrder.address}</div>
                {selectedOrder.notes ? (
                  <div className="mt-2 rounded-2xl border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
                    Note: {selectedOrder.notes}
                  </div>
                ) : null}
              </div>
            </header>

            <div className="flex flex-col gap-4 rounded-3xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Call Console
                </div>
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  <span className="inline-flex h-2.5 w-2.5 items-center justify-center">
                    <span
                      className={`inline-flex h-2.5 w-2.5 rounded-full ${
                        callState === "dialing"
                          ? "bg-amber-400"
                          : callState === "speaking"
                          ? "bg-emerald-400"
                          : callState === "awaiting_response"
                          ? "bg-blue-400"
                          : callState === "resolved"
                          ? "bg-zinc-400"
                          : "bg-zinc-300"
                      }`}
                    />
                  </span>
                  {callState === "idle" && "Idle"}
                  {callState === "dialing" && "Dialing"}
                  {callState === "speaking" && "Agent speaking"}
                  {callState === "awaiting_response" && "Awaiting response"}
                  {callState === "resolved" && "Call completed"}
                  {callState === "muted" && "Muted"}
                </div>
              </div>

              <div className="flex flex-col gap-3 overflow-y-auto rounded-2xl bg-white/60 p-4 text-sm shadow-inner dark:bg-zinc-900/80">
                {conversation.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center text-zinc-400 dark:text-zinc-500">
                    <span className="text-sm font-medium">
                      Call history will appear here.
                    </span>
                    <span className="text-xs">
                      Launch a call to begin the scripted conversation.
                    </span>
                  </div>
                ) : (
                  conversation.map((entry, index) => (
                    <div
                      key={`${entry.timestamp}-${index}`}
                      className={`flex flex-col gap-1 ${
                        entry.speaker === "agent"
                          ? "items-start"
                          : entry.speaker === "customer"
                          ? "items-end"
                          : "items-center"
                      }`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          entry.speaker === "agent"
                            ? "bg-purple-500/10 text-purple-900 dark:bg-purple-500/20 dark:text-purple-100"
                            : entry.speaker === "customer"
                            ? "bg-emerald-500/20 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-100"
                            : "bg-zinc-200/70 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {entry.message}
                      </div>
                      <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                        {entry.speaker === "agent" && "Agent"}
                        {entry.speaker === "customer" && "Customer"}
                        {entry.speaker === "system" && "System"}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {!supported && (
                <div className="rounded-2xl border border-amber-300/60 bg-amber-100/70 px-4 py-3 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-100">
                  Browser speech synthesis is unavailable. The agent voice will
                  stay silent—follow the scripted prompts to advance the call.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                <button
                  type="button"
                  onClick={callInFlight ? toggleMute : startCall}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/30 transition hover:from-purple-500 hover:to-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                >
                  {callInFlight ? (agentMuted ? "Unmute Agent" : "Mute Agent") : "Start Confirmation Call"}
                </button>
                {callInFlight ? (
                  <button
                    type="button"
                    onClick={resetCall}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
                  >
                    End Call
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startCall}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
                  >
                    Replay Script
                  </button>
                )}
                <button
                  type="button"
                  onClick={escalateToSupport}
                  className="inline-flex items-center gap-2 rounded-full border border-transparent bg-white px-4 py-2 text-sm font-medium text-red-500 transition hover:border-red-200 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-500/10"
                >
                  Escalate to Support
                </button>
              </div>
            </div>

            {callState === "awaiting_response" && (
              <div className="rounded-3xl border border-purple-200/60 bg-purple-500/10 p-5 text-sm text-purple-900 dark:border-purple-400/40 dark:bg-purple-500/10 dark:text-purple-100">
                <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-200">
                  Customer response
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleCustomerResponse("confirm")}
                    className="rounded-full bg-white px-4 py-2 font-medium text-purple-700 shadow-sm transition hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 dark:text-purple-100"
                  >
                    Customer confirms order
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCustomerResponse("reschedule")}
                    className="rounded-full bg-white px-4 py-2 font-medium text-purple-700 shadow-sm transition hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 dark:text-purple-100"
                  >
                    Customer needs new slot
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCustomerResponse("cancel")}
                    className="rounded-full bg-white px-4 py-2 font-medium text-purple-700 shadow-sm transition hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 dark:text-purple-100"
                  >
                    Customer cancels
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCustomerResponse("query")}
                    className="rounded-full bg-white px-4 py-2 font-medium text-purple-700 shadow-sm transition hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 dark:text-purple-100"
                  >
                    Customer asks for details
                  </button>
                </div>
              </div>
            )}

            {rescheduleSlot && callOutcome === "rescheduled" ? (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-100/70 px-5 py-4 text-sm font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-100">
                Delivery rescheduled to <strong>{rescheduleSlot}</strong>. SMS
                confirmation sent to the customer.
              </div>
            ) : null}

            {callOutcome === "needs_support" ? (
              <div className="rounded-3xl border border-sky-200 bg-sky-100/70 px-5 py-4 text-sm font-medium text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/20 dark:text-sky-100">
                Escalation logged. A senior specialist will follow up with the
                customer.
              </div>
            ) : null}

            {callState === "awaiting_response" &&
            conversation.some(
              (entry) =>
                entry.speaker === "agent" && entry.awaitingResponse === true
            ) ? (
              <div className="rounded-3xl border border-dashed border-purple-300 bg-white/70 p-5 text-sm text-purple-900 dark:border-purple-400/40 dark:bg-purple-500/10 dark:text-purple-100">
                <div className="flex flex-col gap-2">
                  <div className="font-semibold">
                    Script cue: confirm customer input
                  </div>
                  <p className="text-sm text-purple-700 dark:text-purple-200">
                    Choose how the customer responds to continue the call flow.
                  </p>
                </div>
              </div>
            ) : null}

            {callOutcome === "confirmed" && (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-500/10 px-5 py-4 text-sm font-medium text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100">
                Order marked as confirmed. Logistics team notified for dispatch
                preparation.
              </div>
            )}

            {callOutcome === "cancelled" && (
              <div className="rounded-3xl border border-rose-200 bg-rose-500/10 px-5 py-4 text-sm font-medium text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
                Order cancelled per customer request. Refund will be initiated
                automatically if applicable.
              </div>
            )}

            {callOutcome === "rescheduled" && !rescheduleSlot && (
              <div className="rounded-3xl border border-purple-200 bg-white/80 p-5 text-sm text-purple-900 dark:border-purple-400/30 dark:bg-purple-500/10 dark:text-purple-100">
                <div className="mb-3 font-semibold">
                  Pick a delivery slot to complete reschedule
                </div>
                <div className="flex flex-wrap gap-2">
                  {RESCHEDULE_OPTIONS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => handleRescheduleSelection(slot)}
                      className="rounded-full border border-purple-300 bg-white px-4 py-2 text-sm font-medium text-purple-700 transition hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 dark:bg-purple-500/10 dark:text-purple-100 dark:hover:bg-purple-500/20"
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {callOutcome && callState === "resolved" && (
              <div className="rounded-3xl border border-zinc-200 bg-white/70 px-5 py-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    Call summary
                  </span>
                  <span>
                    Outcome:{" "}
                    <strong className="text-zinc-900 dark:text-zinc-100">
                      {callOutcome === "confirmed" && "Order confirmed"}
                      {callOutcome === "rescheduled" && "Delivery rescheduled"}
                      {callOutcome === "cancelled" && "Order cancelled"}
                      {callOutcome === "needs_support" &&
                        "Escalated to support"}
                    </strong>
                  </span>
                  <span>
                    Transcript saved to CRM with {conversation.length} scripted
                    exchanges.
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100">
              Select an order to begin
            </h2>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Choose a customer from the list to launch the automated order
              confirmation workflow.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};
