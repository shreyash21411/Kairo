(() => {
    console.log(
        "AI Memory: ChatGPT network interceptor starting..."
    );

    /*
     * Prevent installing the interceptor more than once.
     */
    if (
        (window as any).__AI_MEMORY_NETWORK_INTERCEPTOR__
    ) {
        console.log(
            "AI Memory: Network interceptor already installed"
        );

        return;
    }

    (window as any).__AI_MEMORY_NETWORK_INTERCEPTOR__ =
        true;

    const originalFetch = window.fetch;

    window.fetch = async function (
        ...args: Parameters<typeof window.fetch>
    ): Promise<Response> {

        const response = await originalFetch.apply(
            this,
            args
        );

        try {
            const request = args[0];

            let url = "";

            if (typeof request === "string") {
                url = request;
            } else if (request instanceof Request) {
                url = request.url;
            }

            /*
             * We only care about ChatGPT conversation
             * message pagination requests.
             */
            if (
                url.includes(
                    "/backend-api/conversations/"
                ) &&
                url.includes("/messages")
            ) {
                console.log(
                    "AI Memory: Conversation messages API detected:",
                    url
                );

                /*
                 * Clone the response because the original
                 * response still belongs to ChatGPT.
                 */
                const clonedResponse =
                    response.clone();

                clonedResponse
                    .json()
                    .then((data) => {

                        console.log(
                            "AI Memory: Captured messages API response:",
                            data
                        );

                        window.postMessage(
                            {
                                source:
                                    "AI_MEMORY_EXTENSION",
                                type:
                                    "CHATGPT_MESSAGES_RESPONSE",
                                url,
                                data,
                            },
                            window.location.origin
                        );
                    })
                    .catch((error) => {
                        console.error(
                            "AI Memory: Failed to read messages API response:",
                            error
                        );
                    });
            }
        } catch (error) {
            console.error(
                "AI Memory: Network interceptor error:",
                error
            );
        }

        return response;
    };

    console.log(
        "AI Memory: ChatGPT network interceptor installed"
    );
})();