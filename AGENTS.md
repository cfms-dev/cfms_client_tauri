1. Run any commands that related to `npm` via `pnpm` instead. DO NOT use npm as the package manager!
2. When using PowerShell to run commands, if there are multiple commands in one line, use `;` to seperate them, not `&&`.
3. DO NOT start a Vite dev server or something else by yourself, since it's hard to shutdown them.
4. When not specified, use Material Design in your UI design strategy.
5. Throughout the implementation of these features, it is crucial to maintain maximum reusability, maintainability, and organization of the code. Unify disorganized code to avoid inconsistent behavior. Maintain a visually appealing interface; if possible, incorporate sophisticated animations. Given the large number of tasks, plan ahead before execution.
6. Before running a Gradle compilation to verify the code's correctness, ensure that TUN proxy mode is enabled on your host machine. If it's not enabled or you cannot confirm this, do not attempt to compile to avoid network timeout errors.
7. When a new feature is implemented within the same conversation but later modified, avoid writing backward compatibility logic for it, as no users will be affected by legacy issues from the intermediate state. Backward compatibility should only be considered when modifying a feature that wasn't fully implemented in the current conversation.
