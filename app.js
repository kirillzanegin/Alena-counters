// Упрощённый вариант без модулей/JSX.
// React, ReactDOM и Supabase подключены в index.html как UMD-бандлы.

(function () {
  var useState = React.useState;
  var useEffect = React.useEffect;
  var createClient = window.supabase.createClient;

  var SUPABASE_URL = "https://ervtmgbehtwdscvbnvio.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_tsxpOnKQfOhO5yIbUJ0klw_up62oSJo";

  var supabase =
    SUPABASE_URL && SUPABASE_ANON_KEY
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;

  // Нормализация и валидация телефона: +7 и 10 цифр, без пробелов и символов.
  // Пустое поле — допустимо (необязательное). Возвращает { valid, normalized }.
  function normalizePhoneForRussia(raw) {
    var s = (raw || "").trim();
    if (!s) return { valid: true, normalized: null };
    var digits = s.replace(/\D/g, "");
    if (digits.length === 11 && (digits[0] === "8" || digits[0] === "7")) {
      return { valid: true, normalized: "+7" + digits.slice(1) };
    }
    if (digits.length === 10 && digits[0] !== "0") {
      return { valid: true, normalized: "+7" + digits };
    }
    return { valid: false, normalized: null };
  }

  // ---------- ХУК АВТОРИЗАЦИИ ----------

  function useAuth() {
    var sessionState = useState(null);
    var session = sessionState[0];
    var setSession = sessionState[1];

    var employeeState = useState(null);
    var employee = employeeState[0];
    var setEmployee = employeeState[1];

    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    useEffect(function () {
      if (!supabase) {
        setLoading(false);
        setError("Supabase не инициализирован.");
        return;
      }

      var isMounted = true;

      function init() {
        supabase.auth
          .getSession()
          .then(function (result) {
            if (!isMounted) return;

            if (result.error) {
              console.error(result.error);
              setError("Не удалось инициализировать авторизацию.");
              setLoading(false);
              return;
            }

            var initialSession = result.data.session;
            if (initialSession && initialSession.user) {
              fetchEmployeeForUser(initialSession.user).then(function (emp) {
                if (!isMounted) return;
                if (emp && emp.is_active) {
                  setSession(initialSession);
                  setEmployee(emp);
                }
                setLoading(false);
              });
            } else {
              setLoading(false);
            }
          })
          .catch(function (e) {
            console.error(e);
            if (isMounted) {
              setError("Ошибка инициализации авторизации.");
              setLoading(false);
            }
          });
      }

      init();

      var authSubscription = supabase.auth.onAuthStateChange(
        function (event, newSession) {
          if (!isMounted) return;

          if (event === "SIGNED_IN" && newSession && newSession.user) {
            fetchEmployeeForUser(newSession.user).then(function (emp) {
              if (emp && emp.is_active) {
                setSession(newSession);
                setEmployee(emp);
                setError(null);
              } else {
                setError("Доступ запрещён. Обратитесь к администратору.");
                supabase.auth.signOut();
                setSession(null);
                setEmployee(null);
              }
            });
          }

          if (event === "SIGNED_OUT") {
            setSession(null);
            setEmployee(null);
          }
        }
      );

      return function () {
        isMounted = false;
        try {
          authSubscription.data.subscription.unsubscribe();
        } catch (e) {}
      };
    }, []);

    function fetchEmployeeForUser(user, autoBindTelegramId) {
      if (!supabase || !user) return Promise.resolve(null);
      return supabase
        .from("employees")
        .select("id, first_name, last_name, is_active, tg_id, role")
        .eq("auth_user_id", user.id)
        .maybeSingle()
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось загрузить данные сотрудника.");
            return null;
          }
          var emp = result.data;
          
          // Автоматическая привязка Telegram ID при входе из Telegram WebApp
          if (emp && autoBindTelegramId && !emp.tg_id) {
            // Сначала проверяем, не привязан ли уже этот Telegram ID к другому пользователю
            return supabase
              .from("employees")
              .select("id, first_name, last_name, email")
              .eq("tg_id", String(autoBindTelegramId))
              .eq("is_active", true)
              .maybeSingle()
              .then(function (checkResult) {
                if (checkResult.data) {
                  // Telegram уже привязан к другому пользователю
                  var otherUser = checkResult.data;
                  var otherUserName = otherUser.first_name 
                    ? (otherUser.first_name + " " + (otherUser.last_name || "")).trim()
                    : otherUser.email;
                  
                  setError(
                    "⚠️ Этот Telegram аккаунт уже привязан к другому пользователю (" + otherUserName + "). " +
                    "Сначала отвяжите его в веб-приложении или обратитесь к администратору."
                  );
                  return emp; // Возвращаем сотрудника без привязки
                }
                
                // Telegram ID свободен, привязываем
                return supabase
                  .from("employees")
                  .update({ tg_id: String(autoBindTelegramId) })
                  .eq("id", emp.id)
                  .then(function (upd) {
                    if (!upd.error) {
                      emp.tg_id = String(autoBindTelegramId);
                      console.log("✅ Telegram ID автоматически привязан:", autoBindTelegramId);
                    } else {
                      console.error("❌ Ошибка привязки Telegram:", upd.error);
                    }
                    return emp;
                  });
              });
          }
          
          return emp;
        });
    }

    function login(email, password) {
      if (!supabase) {
        setError("Supabase не инициализирован.");
        return Promise.resolve();
      }
      setError(null);

      var telegramId = null;
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
        telegramId = window.Telegram.WebApp.initDataUnsafe.user.id;
      }

      return supabase.auth
        .signInWithPassword({ email: email, password: password })
        .then(function (result) {
          if (result.error || !result.data.session || !result.data.session.user) {
            console.error(result.error);
            setError("Не удалось войти. Проверьте email и пароль.");
            return;
          }

          var newSession = result.data.session;
          return fetchEmployeeForUser(newSession.user, telegramId).then(function (emp) {
            if (emp && emp.is_active) {
              setSession(newSession);
              setEmployee(emp);
            } else {
              setError("Доступ запрещён. Обратитесь к администратору.");
              supabase.auth.signOut();
              setSession(null);
              setEmployee(null);
            }
          });
        });
    }

    function logout() {
      if (supabase) {
        supabase.auth.signOut().catch(function (e) {
          console.error(e);
        });
      }
      setSession(null);
      setEmployee(null);
    }

    return {
      session: session,
      employee: employee,
      loading: loading,
      error: error,
      login: login,
      logout: logout,
      supabaseReady: !!supabase,
    };
  }

  // ---------- КОМПОНЕНТЫ ----------

  function LoginForm(props) {
    var emailState = useState("");
    var email = emailState[0];
    var setEmail = emailState[1];

    var passwordState = useState("");
    var password = passwordState[0];
    var setPassword = passwordState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var disabled = !props.supabaseReady || props.loading || submitting;

    function onSubmit(e) {
      e.preventDefault();
      if (disabled) return;
      setSubmitting(true);
      props.onLogin(email.trim(), password).finally(function () {
        setSubmitting(false);
      });
    }

    return React.createElement(
      "div",
      { className: "panel" },
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Вход в систему"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            "Доступ только для сотрудников компании."
          )
        ),
        React.createElement("span", { className: "badge" }, "Блок 01 — Авторизация")
      ),
      React.createElement(
        "p",
        { className: "panel-tagline" },
        "Введите корпоративный email и пароль. После успешного входа система проверит, что сотрудник активен."
      ),
      React.createElement("div", { className: "divider" }),
      React.createElement(
        "form",
        { className: "form", onSubmit: onSubmit },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Email сотрудника",
            React.createElement("span", null, "*")
          ),
          React.createElement("input", {
            className: "input",
            type: "email",
            required: true,
            placeholder: "user@company.ru",
            value: email,
            onChange: function (e) {
              setEmail(e.target.value);
            },
            disabled: disabled,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Пароль",
            React.createElement("span", null, "*")
          ),
          React.createElement("input", {
            className: "input",
            type: "password",
            required: true,
            placeholder: "Введите пароль",
            value: password,
            onChange: function (e) {
              setPassword(e.target.value);
            },
            disabled: disabled,
          })
        ),
        React.createElement(
          "button",
          { className: "button", type: "submit", disabled: disabled },
          submitting || props.loading ? "Вход..." : "Войти"
        )
      ),
      props.error &&
        React.createElement(
          "div",
          { className: "alert alert-error" },
          React.createElement("div", { className: "alert-icon" }, "!"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Ошибка авторизации"
            ),
            React.createElement("div", { className: "alert-text" }, props.error)
          )
        )
    );
  }

  // ---------- КОМПОНЕНТ ПЛИТКИ ----------

  function MenuTile(props) {
    return React.createElement(
      "div",
      {
        className: "menu-tile" + (props.primary ? " primary" : ""),
        onClick: props.onClick,
      },
      React.createElement(
        "div",
        { className: "menu-tile-icon" },
        props.icon || "📋"
      ),
      React.createElement(
        "div",
        { className: "menu-tile-title" },
        props.title
      ),
      React.createElement(
        "div",
        { className: "menu-tile-description" },
        props.description
      )
    );
  }

  // ---------- ГЛАВНОЕ МЕНЮ ----------

  function MainMenu(props) {
    var tgLinked = !!props.employee.tg_id;
    var role = props.employee.role || "user";
    var roleLabel = role === "owner" ? "Владелец" : "Пользователь";

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { style: { marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid rgba(148, 163, 184, 0.2)" } },
        React.createElement(
          "div",
          { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" } },
          React.createElement(
            "div",
            { className: "top-bar-user" },
            "Сотрудник: ",
            React.createElement(
              "strong",
              null,
              props.employee.first_name || "Не указано",
              " ",
              props.employee.last_name || ""
            ),
            " ",
            React.createElement(
              "span",
              { style: { fontSize: "11px", color: "var(--text-muted)", fontWeight: "normal" } },
              "(",
              roleLabel,
              ")"
            )
          ),
          React.createElement(
            "button",
            {
              className: "button-ghost",
              type: "button",
              onClick: props.onLogout,
            },
            "Выйти"
          )
        ),
        React.createElement(
          "div",
          { style: { display: "flex", justifyContent: "flex-start" } },
          React.createElement(
            "button",
            {
              className: "button-ghost",
              type: "button",
              onClick: function () {
                props.onNavigate("telegram");
              },
              style: {
                background: tgLinked ? "transparent" : "linear-gradient(135deg, #dc2626, #991b1b)",
                borderColor: tgLinked ? "rgba(59, 130, 246, 0.9)" : "rgba(220, 38, 38, 0.9)",
                borderWidth: "1px",
                borderStyle: "solid",
                color: tgLinked ? "rgba(59, 130, 246, 1)" : "#ffffff",
                fontSize: "11px",
                padding: "4px 10px",
                height: "28px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                pointerEvents: "auto",
              }
            },
            !tgLinked && React.createElement(
              "span",
              {
                style: {
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#ffffff",
                  display: "inline-block"
                }
              }
            ),
            tgLinked ? "📱 Telegram подключён" : "📱 Подключить Telegram"
          )
        )
      ),
      React.createElement(
        "div",
        { className: "menu-grid" },
        React.createElement(MenuTile, {
          primary: true,
          icon: "📊",
          title: "Внести показания",
          description: "Поиск объекта и ввод показаний счётчиков",
          onClick: function () {
            props.onNavigate("readings");
          },
        }),
        role === "owner" && React.createElement(MenuTile, {
          icon: "🏢",
          title: "Создать объект",
          description: "Добавить новый объект учёта в систему",
          onClick: function () {
            props.onNavigate("create-object");
          },
        }),
        role === "owner" && React.createElement(MenuTile, {
          icon: "✏️",
          title: "Редактировать объект",
          description: "Изменить данные объекта и показания счётчиков",
          onClick: function () {
            props.onNavigate("edit-object");
          },
        }),
        React.createElement(MenuTile, {
          icon: "📈",
          title: "Статистика",
          description: "Таблица показаний счётчиков по месяцам",
          onClick: function () {
            props.onNavigate("stats");
          },
        }),
        role === "owner" && React.createElement(MenuTile, {
          icon: "📦",
          title: "Архив",
          description: "Неактивные объекты и их реактивация",
          onClick: function () {
            props.onNavigate("archive");
          },
        }),
        role === "owner" && React.createElement(MenuTile, {
          icon: "👥",
          title: "Управление пользователями",
          description: "Создание учётных записей и назначение ролей",
          onClick: function () {
            props.onNavigate("users");
          },
        })
      )
    );
  }

  // ---------- ЭКРАНЫ-ЗАГЛУШКИ ----------

  function ReadingsScreen(props) {
    var searchQueryState = useState("");
    var searchQuery = searchQueryState[0];
    var setSearchQuery = searchQueryState[1];

    var objectsState = useState([]);
    var objects = objectsState[0];
    var setObjects = objectsState[1];

    var selectedObjectState = useState(null);
    var selectedObject = selectedObjectState[0];
    var setSelectedObject = selectedObjectState[1];

    var countersState = useState([]);
    var counters = countersState[0];
    var setCounters = countersState[1];

    var readingDateState = useState("");
    var readingDate = readingDateState[0];
    var setReadingDate = readingDateState[1];

    var indicationsState = useState({});
    var indications = indicationsState[0];
    var setIndications = indicationsState[1];

    var searchingState = useState(false);
    var searching = searchingState[0];
    var setSearching = searchingState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    useEffect(function () {
      loadAllObjects();
    }, []);

    function loadAllObjects() {
      setSearching(true);
      setError(null);

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка загрузки объектов");
            setSearching(false);
            return;
          }

          var sorted = result.data.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке объектов");
          setSearching(false);
        });
    }

    function handleSearch() {
      if (!searchQuery.trim()) {
        loadAllObjects();
        return;
      }

      setSearching(true);
      setError(null);
      setSelectedObject(null);

      var query = searchQuery.trim().toLowerCase();

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка поиска объектов");
            setSearching(false);
            return;
          }

          var filtered = result.data.filter(function (obj) {
            var name = (obj.object_name || "").toLowerCase();
            var address = (obj.object_address || "").toLowerCase();
            return name.indexOf(query) !== -1 || address.indexOf(query) !== -1;
          });

          var sorted = filtered.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);

          if (sorted.length === 0) {
            setError("Объекты не найдены. Попробуйте изменить запрос.");
          }
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при поиске объектов");
          setSearching(false);
        });
    }

    function handleSelectObject(obj) {
      setSelectedObject(obj);
      setError(null);
      setSuccess(false);
      setIndications({});

      var today = new Date();
      var yyyy = today.getFullYear();
      var mm = String(today.getMonth() + 1).padStart(2, "0");
      var dd = String(today.getDate()).padStart(2, "0");
      setReadingDate(yyyy + "-" + mm + "-" + dd);

      supabase
        .from("counters")
        .select("*")
        .eq("object_id", obj.id)
        .eq("is_active", true)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось загрузить счётчики объекта");
            return;
          }

          setCounters(result.data);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке счётчиков");
        });
    }

    function handleIndicationChange(counterId, value) {
      var updated = {};
      for (var key in indications) {
        updated[key] = indications[key];
      }
      updated[counterId] = value;
      setIndications(updated);
    }

    function handleSubmitReadings(e) {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!readingDate) {
        setError("Выберите дату показаний");
        return;
      }

      var readingsToInsert = [];
      for (var i = 0; i < counters.length; i++) {
        var counter = counters[i];
        var value = indications[counter.id];
        if (value && value.trim()) {
          readingsToInsert.push({
            counter_id: counter.id,
            indication: parseFloat(value),
            reading_date: readingDate,
            submitted_by_employee_id: props.employee.id,
          });
        }
      }

      if (readingsToInsert.length === 0) {
        setError("Введите хотя бы одно показание");
        return;
      }

      setSubmitting(true);

      supabase
        .from("meter_readings")
        .insert(readingsToInsert)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            if (
              result.error.message &&
              result.error.message.indexOf("duplicate") !== -1
            ) {
              setError(
                "Показания на эту дату уже существуют для одного из счётчиков"
              );
            } else {
              setError("Ошибка при сохранении показаний: " + result.error.message);
            }
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSubmitting(false);
          setIndications({});
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при сохранении показаний");
          setSubmitting(false);
        });
    }

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { className: "top-bar" },
        React.createElement(
          "button",
          {
            className: "back-button",
            onClick: function () {
              props.onNavigate("menu");
            },
          },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Внести показания"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            selectedObject
              ? selectedObject.object_name
              : "Поиск объекта и ввод показаний счётчиков"
          )
        ),
        React.createElement("span", { className: "badge" }, "Блок 03")
      ),
      React.createElement("div", { className: "divider" }),
      !selectedObject
        ? React.createElement(
            "div",
            null,
            searching && objects.length === 0 && !error &&
              React.createElement(
                "div",
                { className: "hint", style: { marginBottom: "12px" } },
                "⏳ Загрузка объектов..."
              ),
            React.createElement(
              "div",
              { className: "field-label" },
              "Поиск объекта"
            ),
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "8px" } },
              "Введите название или адрес для поиска, или оставьте пустым для отображения всех объектов"
            ),
            React.createElement(
              "div",
              { style: { display: "flex", gap: "8px" } },
              React.createElement("input", {
                className: "input",
                type: "text",
                placeholder: "Поиск по названию или адресу",
                value: searchQuery,
                onChange: function (e) {
                  setSearchQuery(e.target.value);
                },
                onKeyPress: function (e) {
                  if (e.key === "Enter") {
                    handleSearch();
                  }
                },
                disabled: searching,
              }),
              React.createElement(
                "button",
                {
                  className: "button",
                  type: "button",
                  onClick: handleSearch,
                  disabled: searching,
                  style: { marginTop: 0 },
                },
                searching ? "Поиск..." : searchQuery.trim() ? "Найти" : "Обновить"
              ),
              searchQuery.trim() && React.createElement(
                "button",
                {
                  className: "button-secondary button",
                  type: "button",
                  onClick: function () {
                    setSearchQuery("");
                    loadAllObjects();
                  },
                  disabled: searching,
                  style: { marginTop: 0 },
                },
                "Очистить"
              )
            ),
            objects.length > 0 &&
              React.createElement(
                "div",
                { style: { marginTop: "16px" } },
                React.createElement(
                  "div",
                  { className: "field-label" },
                  searchQuery.trim() 
                    ? "Найдено объектов: " + objects.length
                    : "Активных объектов: " + objects.length + " (отсортированы по алфавиту)"
                ),
                React.createElement(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                  objects.map(function (obj) {
                    return React.createElement(
                      "div",
                      {
                        key: obj.id,
                        className: "user-card",
                        onClick: function () {
                          handleSelectObject(obj);
                        },
                        style: { cursor: "pointer" },
                      },
                      React.createElement(
                        "div",
                        { className: "user-card-main" },
                        React.createElement(
                          "div",
                          { className: "user-meta" },
                          React.createElement(
                            "div",
                            { className: "user-name" },
                            obj.object_name
                          ),
                          React.createElement(
                            "div",
                            { className: "user-role" },
                            obj.object_address
                          )
                        )
                      ),
                      React.createElement(
                        "button",
                        {
                          className: "button-ghost",
                          type: "button",
                        },
                        "Выбрать →"
                      )
                    );
                  })
                )
              )
          )
        : React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { style: { marginBottom: "16px" } },
              React.createElement(
                "div",
                { className: "user-card" },
                React.createElement(
                  "div",
                  { className: "user-card-main" },
                  React.createElement(
                    "div",
                    { className: "user-meta" },
                    React.createElement(
                      "div",
                      { className: "user-name" },
                      selectedObject.object_name
                    ),
                    React.createElement(
                      "div",
                      { className: "user-role" },
                      selectedObject.object_address
                    ),
                    selectedObject.area &&
                      React.createElement(
                        "div",
                        { className: "user-role" },
                        "Площадь: ",
                        selectedObject.area,
                        " м²"
                      ),
                    selectedObject.contacts &&
                      React.createElement(
                        "div",
                        { className: "user-role" },
                        "Контакты: ",
                        selectedObject.contacts
                      )
                  )
                ),
                React.createElement(
                  "button",
                  {
                    className: "button-ghost",
                    type: "button",
                    onClick: function () {
                      setSelectedObject(null);
                      setCounters([]);
                      setIndications({});
                      setError(null);
                      setSuccess(false);
                    },
                  },
                  "Сменить объект"
                )
              )
            ),
            counters.length > 0
              ? React.createElement(
                  "form",
                  { onSubmit: handleSubmitReadings },
                  React.createElement(
                    "div",
                    null,
                    React.createElement(
                      "div",
                      { className: "field-label" },
                      "Дата показаний",
                      React.createElement("span", null, "*")
                    ),
                    React.createElement("input", {
                      className: "input",
                      type: "date",
                      required: true,
                      value: readingDate,
                      onChange: function (e) {
                        setReadingDate(e.target.value);
                      },
                      disabled: submitting,
                    })
                  ),
                  React.createElement("div", { className: "divider" }),
                  React.createElement(
                    "div",
                    { className: "field-label" },
                    "Показания счётчиков"
                  ),
                  React.createElement(
                    "div",
                    { style: { display: "flex", flexDirection: "column", gap: "12px" } },
                    counters.map(function (counter) {
                      return React.createElement(
                        "div",
                        { key: counter.id },
                        React.createElement(
                          "div",
                          { className: "field-label" },
                          counter.counter_type,
                          counter.counter_number
                            ? " • № " + counter.counter_number
                            : ""
                        ),
                        React.createElement("input", {
                          className: "input",
                          type: "number",
                          step: "0.01",
                          placeholder: "Введите показание",
                          value: indications[counter.id] || "",
                          onChange: function (e) {
                            handleIndicationChange(counter.id, e.target.value);
                          },
                          disabled: submitting,
                        })
                      );
                    })
                  ),
                  React.createElement(
                    "button",
                    {
                      className: "button",
                      type: "submit",
                      disabled: submitting,
                    },
                    submitting ? "Сохранение..." : "Сохранить показания"
                  )
                )
              : React.createElement(
                  "div",
                  { className: "alert alert-info" },
                  React.createElement("div", { className: "alert-icon" }, "i"),
                  React.createElement(
                    "div",
                    { className: "alert-body" },
                    React.createElement(
                      "div",
                      { className: "alert-title" },
                      "Нет активных счётчиков"
                    ),
                    React.createElement(
                      "div",
                      { className: "alert-text" },
                      "У этого объекта нет активных счётчиков. Добавьте счётчики через редактирование объекта."
                    )
                  )
                )
          ),
      error &&
        React.createElement(
          "div",
          { className: "alert alert-error" },
          React.createElement("div", { className: "alert-icon" }, "!"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement("div", { className: "alert-title" }, "Ошибка"),
            React.createElement("div", { className: "alert-text" }, error)
          )
        ),
      success &&
        React.createElement(
          "div",
          { className: "alert alert-success" },
          React.createElement("div", { className: "alert-icon" }, "✓"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Показания сохранены"
            ),
            React.createElement(
              "div",
              { className: "alert-text" },
              "Показания успешно внесены в систему."
            )
          )
        )
    );
  }

  function CreateObjectScreen(props) {
    var objectNameState = useState("");
    var objectName = objectNameState[0];
    var setObjectName = objectNameState[1];

    var objectAddressState = useState("");
    var objectAddress = objectAddressState[0];
    var setObjectAddress = objectAddressState[1];

    var areaState = useState("");
    var area = areaState[0];
    var setArea = areaState[1];

    var contactsState = useState("");
    var contacts = contactsState[0];
    var setContacts = contactsState[1];

    var commentsState = useState("");
    var comments = commentsState[0];
    var setComments = commentsState[1];

    var selectedCountersState = useState({});
    var selectedCounters = selectedCountersState[0];
    var setSelectedCounters = selectedCountersState[1];

    // Initialize selectedCounters when counterTypes loads
    useEffect(function () {
      if (props.counterTypes && props.counterTypes.length > 0) {
        var initialCounters = props.counterTypes.reduce(function (acc, type) {
          acc[type] = false;
          return acc;
        }, {});
        setSelectedCounters(initialCounters);
      }
    }, [props.counterTypes]);

    var counterNumbersState = useState({});
    var counterNumbers = counterNumbersState[0];
    var setCounterNumbers = counterNumbersState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    var assignedEmployeeIdState = useState("");
    var assignedEmployeeId = assignedEmployeeIdState[0];
    var setAssignedEmployeeId = assignedEmployeeIdState[1];

    var ownerIdState = useState("");
    var ownerId = ownerIdState[0];
    var setOwnerId = ownerIdState[1];

    var userListState = useState([]);
    var userList = userListState[0];
    var setUserList = userListState[1];

    useEffect(function () {
      supabase
        .from("employees")
        .select("id, first_name, last_name, email")
        .eq("role", "user")
        .eq("is_active", true)
        .order("first_name")
        .then(function (res) {
          if (!res.error && res.data) setUserList(res.data);
        });
    }, []);

    function handleCounterToggle(type) {
      var updated = {};
      for (var key in selectedCounters) {
        updated[key] = selectedCounters[key];
      }
      updated[type] = !selectedCounters[type];
      setSelectedCounters(updated);
    }

    function handleCounterNumberChange(type, value) {
      var updated = {};
      for (var key in counterNumbers) {
        updated[key] = counterNumbers[key];
      }
      updated[type] = value;
      setCounterNumbers(updated);
    }

    function handleSubmit(e) {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!objectName.trim() || !objectAddress.trim()) {
        setError("Название и адрес объекта обязательны.");
        return;
      }

      var hasCounters = false;
      for (var key in selectedCounters) {
        if (selectedCounters[key]) {
          hasCounters = true;
          break;
        }
      }

      if (!hasCounters) {
        setError("Выберите хотя бы один тип счётчика.");
        return;
      }

      setSubmitting(true);

      var objectData = {
        object_name: objectName.trim(),
        object_address: objectAddress.trim(),
        area: area.trim() ? parseFloat(area) : null,
        contacts: contacts.trim() || null,
        comments: comments.trim() || null,
        is_active: true,
        assigned_employee_id: assignedEmployeeId ? parseInt(assignedEmployeeId, 10) : null,
        owner_id: ownerId && ownerId.trim() ? ownerId.trim() : null,
      };

      supabase
        .from("objects")
        .insert([objectData])
        .select()
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось создать объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          var newObject = result.data[0];
          var countersToInsert = [];

          for (var type in selectedCounters) {
            if (selectedCounters[type]) {
              var counterNumber = counterNumbers[type];
              countersToInsert.push({
                object_id: newObject.id,
                counter_type: type,
                counter_number: counterNumber && counterNumber.trim() ? counterNumber.trim() : null,
                is_active: true,
              });
            }
          }

          return supabase
            .from("counters")
            .insert(countersToInsert)
            .then(function (counterResult) {
              if (counterResult.error) {
                console.error(counterResult.error);
                setError(
                  "Объект создан, но не удалось добавить счётчики: " +
                    counterResult.error.message
                );
                setSubmitting(false);
                return;
              }

              setSuccess(true);
              setSubmitting(false);

              setObjectName("");
              setObjectAddress("");
              setArea("");
              setContacts("");
              setComments("");
              setAssignedEmployeeId("");
              setOwnerId("");
              setSelectedCounters(
                (props.counterTypes || []).reduce(function (acc, type) {
                  acc[type] = false;
                  return acc;
                }, {})
              );
              setCounterNumbers({});
            });
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при создании объекта.");
          setSubmitting(false);
        });
    }

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { className: "top-bar" },
        React.createElement(
          "button",
          {
            className: "back-button",
            onClick: function () {
              props.onNavigate("menu");
            },
          },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Создать объект"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            "Добавление нового объекта учёта и его счётчиков"
          )
        ),
        React.createElement("span", { className: "badge" }, "Блок 04")
      ),
      React.createElement("div", { className: "divider" }),
      React.createElement(
        "form",
        { className: "form", onSubmit: handleSubmit },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Название объекта",
            React.createElement("span", null, "*")
          ),
          React.createElement("input", {
            className: "input",
            type: "text",
            required: true,
            placeholder: "Например: Офис на Ленина",
            value: objectName,
            onChange: function (e) {
              setObjectName(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Адрес объекта",
            React.createElement("span", null, "*")
          ),
          React.createElement("input", {
            className: "input",
            type: "text",
            required: true,
            placeholder: "Полный адрес объекта",
            value: objectAddress,
            onChange: function (e) {
              setObjectAddress(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Площадь (м²)"
          ),
          React.createElement("input", {
            className: "input",
            type: "number",
            step: "0.01",
            placeholder: "Площадь объекта",
            value: area,
            onChange: function (e) {
              setArea(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Контакты"
          ),
          React.createElement("textarea", {
            className: "input",
            rows: 2,
            placeholder: "ФИО, телефон, email ответственного лица",
            value: contacts,
            onChange: function (e) {
              setContacts(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Комментарии"
          ),
          React.createElement("textarea", {
            className: "input",
            rows: 2,
            placeholder: "Дополнительная информация",
            value: comments,
            onChange: function (e) {
              setComments(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Владелец (принадлежность объекта)"
          ),
          React.createElement(
            "select",
            {
              className: "input",
              value: ownerId,
              onChange: function (e) {
                setOwnerId(e.target.value);
              },
              disabled: submitting,
            },
            React.createElement("option", { value: "" }, "— Не выбрано —"),
            (props.owners || []).map(function (o) {
              return React.createElement(
                "option",
                { key: o.id, value: o.id },
                o.name
              );
            })
          )
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Закрепить за пользователем"
          ),
          React.createElement(
            "select",
            {
              className: "input",
              value: assignedEmployeeId,
              onChange: function (e) {
                setAssignedEmployeeId(e.target.value);
              },
              disabled: submitting,
            },
            React.createElement("option", { value: "" }, "— Не назначен —"),
            userList.map(function (emp) {
              return React.createElement(
                "option",
                { key: emp.id, value: String(emp.id) },
                (emp.first_name || "") + " " + (emp.last_name || "") + (emp.email ? " (" + emp.email + ")" : "")
              );
            })
          )
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { className: "field-label" },
          "Типы счётчиков",
          React.createElement("span", null, "*")
        ),
        React.createElement(
          "div",
          { className: "hint", style: { marginBottom: "12px" } },
          "Список загружается из базы данных. Выберите нужные типы и укажите номера приборов (опционально)."
        ),
        !(props.counterTypes && props.counterTypes.length) ? React.createElement(
          "div",
          { className: "hint", style: { padding: "12px", color: "rgba(255,255,255,0.6)" } },
          "Типы счётчиков загружаются..."
        ) : React.createElement(
          "div",
          { 
            style: { 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "12px" 
            } 
          },
          props.counterTypes.map(function (counterType) {
            return (function (type) {
              return React.createElement(
                "div",
                { 
                  key: type,
                  style: { 
                    display: "flex", 
                    flexDirection: "column",
                    gap: "6px",
                    padding: "8px",
                    border: "1px solid rgba(148, 163, 184, 0.3)",
                    borderRadius: "8px",
                  } 
                },
                React.createElement(
                  "label",
                  { style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" } },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: selectedCounters[type] || false,
                    onChange: function () { handleCounterToggle(type); },
                    disabled: submitting,
                  }),
                  React.createElement("span", { style: { fontWeight: "500" } }, type)
                ),
                selectedCounters[type] && React.createElement("input", {
                  className: "input",
                  type: "text",
                  placeholder: "Номер прибора (опц.)",
                  value: counterNumbers[type] || "",
                  onChange: function (e) { handleCounterNumberChange(type, e.target.value); },
                  disabled: submitting,
                  style: { marginTop: "0" },
                })
              );
            })(counterType);
          })
        ),
        React.createElement(
          "button",
          {
            className: "button",
            type: "submit",
            disabled: submitting,
          },
          submitting ? "Создание..." : "Создать объект"
        )
      ),
      error &&
        React.createElement(
          "div",
          { className: "alert alert-error" },
          React.createElement("div", { className: "alert-icon" }, "!"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Ошибка"
            ),
            React.createElement("div", { className: "alert-text" }, error)
          )
        ),
      success &&
        React.createElement(
          "div",
          { className: "alert alert-success" },
          React.createElement("div", { className: "alert-icon" }, "✓"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Объект создан"
            ),
            React.createElement(
              "div",
              { className: "alert-text" },
              "Объект успешно добавлен в систему со счётчиками."
            )
          )
        )
    );
  }

  function StatsScreen(props) {
    var searchQueryState = useState("");
    var searchQuery = searchQueryState[0];
    var setSearchQuery = searchQueryState[1];

    var objectsState = useState([]);
    var objects = objectsState[0];
    var setObjects = objectsState[1];

    var selectedObjectState = useState(null);
    var selectedObject = selectedObjectState[0];
    var setSelectedObject = selectedObjectState[1];

    var searchingState = useState(false);
    var searching = searchingState[0];
    var setSearching = searchingState[1];

    var stepState = useState("select");
    var step = stepState[0];
    var setStep = stepState[1];

    var startMonthState = useState("");
    var startMonth = startMonthState[0];
    var setStartMonth = startMonthState[1];

    var endMonthState = useState("");
    var endMonth = endMonthState[0];
    var setEndMonth = endMonthState[1];

    var statisticsState = useState(null);
    var statistics = statisticsState[0];
    var setStatistics = statisticsState[1];

    var loadingState = useState(false);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    useEffect(function () {
      if (step === "select") {
        loadAllObjects();
      }
    }, [step]);

    function loadAllObjects() {
      setSearching(true);
      setError(null);

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка загрузки объектов");
            setSearching(false);
            return;
          }

          var sorted = result.data.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке объектов");
          setSearching(false);
        });
    }

    function handleSearch() {
      if (!searchQuery.trim()) {
        loadAllObjects();
        return;
      }

      setSearching(true);
      setError(null);

      var query = searchQuery.trim().toLowerCase();

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка поиска объектов");
            setSearching(false);
            return;
          }

          var filtered = result.data.filter(function (obj) {
            var name = (obj.object_name || "").toLowerCase();
            var address = (obj.object_address || "").toLowerCase();
            return name.indexOf(query) !== -1 || address.indexOf(query) !== -1;
          });

          var sorted = filtered.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);

          if (sorted.length === 0) {
            setError("Объекты не найдены. Попробуйте изменить запрос.");
          }
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при поиске объектов");
          setSearching(false);
        });
    }

    function handleSelectObject(obj) {
      setSelectedObject(obj);
      setStep("select-period");
      setError(null);
      
      var today = new Date();
      var currentYear = today.getFullYear();
      var currentMonth = String(today.getMonth() + 1).padStart(2, "0");
      var threeMonthsAgo = new Date(today);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      var startYear = threeMonthsAgo.getFullYear();
      var startMonthNum = String(threeMonthsAgo.getMonth() + 1).padStart(2, "0");
      
      setStartMonth(startYear + "-" + startMonthNum);
      setEndMonth(currentYear + "-" + currentMonth);
    }

    function handleLoadStatistics() {
      if (!startMonth || !endMonth) {
        setError("Выберите период");
        return;
      }

      if (startMonth > endMonth) {
        setError("Начальный месяц не может быть позже конечного");
        return;
      }

      setError(null);
      setLoading(true);

      supabase
        .from("counters")
        .select("id, counter_type, counter_number")
        .eq("object_id", selectedObject.id)
        .eq("is_active", true)
        .then(function (countersResult) {
          if (countersResult.error) {
            console.error(countersResult.error);
            setError("Ошибка загрузки счётчиков");
            setLoading(false);
            return;
          }

          if (countersResult.data.length === 0) {
            setError("У объекта нет активных счётчиков");
            setLoading(false);
            return;
          }

          var counterIds = countersResult.data.map(function (c) {
            return c.id;
          });

          var startDate = startMonth + "-01";
          var endParts = endMonth.split("-");
          var endYear = parseInt(endParts[0]);
          var endMonthNum = parseInt(endParts[1]);
          var nextMonth = endMonthNum === 12 ? 1 : endMonthNum + 1;
          var nextYear = endMonthNum === 12 ? endYear + 1 : endYear;
          var endDate = nextYear + "-" + String(nextMonth).padStart(2, "0") + "-01";

          return supabase
            .from("meter_readings")
            .select("*")
            .in("counter_id", counterIds)
            .gte("reading_date", startDate)
            .lt("reading_date", endDate)
            .then(function (readingsResult) {
              if (readingsResult.error) {
                console.error(readingsResult.error);
                setError("Ошибка загрузки показаний");
                setLoading(false);
                return;
              }

              var months = [];
              var currentDate = new Date(startMonth + "-01");
              var endDateObj = new Date(endMonth + "-01");
              
              while (currentDate <= endDateObj) {
                var year = currentDate.getFullYear();
                var month = String(currentDate.getMonth() + 1).padStart(2, "0");
                months.push(year + "-" + month);
                currentDate.setMonth(currentDate.getMonth() + 1);
              }

              var monthNames = {
                "01": "Январь", "02": "Февраль", "03": "Март", "04": "Апрель",
                "05": "Май", "06": "Июнь", "07": "Июль", "08": "Август",
                "09": "Сентябрь", "10": "Октябрь", "11": "Ноябрь", "12": "Декабрь"
              };

              var statsData = {
                counters: countersResult.data,
                months: months.map(function(m) {
                  var parts = m.split("-");
                  return {
                    key: m,
                    label: monthNames[parts[1]] + " " + parts[0]
                  };
                }),
                data: {}
              };

              countersResult.data.forEach(function(counter) {
                statsData.data[counter.id] = {};
                months.forEach(function(month) {
                  var readings = readingsResult.data.filter(function(r) {
                    return r.counter_id === counter.id && r.reading_date.startsWith(month);
                  });
                  
                  if (readings.length > 0) {
                    var latest = readings.sort(function(a, b) {
                      if (a.reading_date > b.reading_date) return -1;
                      if (a.reading_date < b.reading_date) return 1;
                      return 0;
                    })[0];
                    statsData.data[counter.id][month] = latest.indication;
                  } else {
                    statsData.data[counter.id][month] = null;
                  }
                });
              });

              setStatistics(statsData);
              setStep("view");
              setLoading(false);
            });
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке данных");
          setLoading(false);
        });
    }

    if (step === "select") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
            onClick: function () {
              props.onNavigate("menu");
            },
          },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Статистика"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            "Выберите объект для просмотра статистики"
          )
          ),
          React.createElement("span", { className: "badge" }, "Блок 06")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          null,
          searching && objects.length === 0 && !error &&
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "12px" } },
              "⏳ Загрузка объектов..."
            ),
          React.createElement(
            "div",
            { className: "field-label" },
            "Поиск объекта"
          ),
          React.createElement(
            "div",
            { className: "hint", style: { marginBottom: "8px" } },
            "Введите название или адрес для поиска"
          ),
          React.createElement(
            "div",
            { style: { display: "flex", gap: "8px" } },
            React.createElement("input", {
              className: "input",
              type: "text",
              placeholder: "Поиск по названию или адресу",
              value: searchQuery,
              onChange: function (e) {
                setSearchQuery(e.target.value);
              },
              onKeyPress: function (e) {
                if (e.key === "Enter") {
                  handleSearch();
                }
              },
              disabled: searching,
            }),
            React.createElement(
              "button",
              {
                className: "button",
                type: "button",
                onClick: handleSearch,
                disabled: searching,
                style: { marginTop: 0 },
              },
              searching ? "Поиск..." : searchQuery.trim() ? "Найти" : "Обновить"
            ),
            searchQuery.trim() && React.createElement(
              "button",
              {
                className: "button-secondary button",
                type: "button",
                onClick: function () {
                  setSearchQuery("");
                  loadAllObjects();
                },
                disabled: searching,
                style: { marginTop: 0 },
              },
              "Очистить"
            )
          ),
          objects.length > 0 &&
            React.createElement(
              "div",
              { style: { marginTop: "16px" } },
              React.createElement(
                "div",
                { className: "field-label" },
                searchQuery.trim() 
                  ? "Найдено объектов: " + objects.length
                  : "Активных объектов: " + objects.length + " (отсортированы по алфавиту)"
              ),
              React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                objects.map(function (obj) {
                  return React.createElement(
                    "div",
                    {
                      key: obj.id,
                      className: "user-card",
                      onClick: function () {
                        handleSelectObject(obj);
                      },
                      style: { cursor: "pointer" },
                    },
                    React.createElement(
                      "div",
                      { className: "user-card-main" },
                      React.createElement(
                        "div",
                        { className: "user-meta" },
                        React.createElement(
                          "div",
                          { className: "user-name" },
                          obj.object_name
                        ),
                        React.createElement(
                          "div",
                          { className: "user-role" },
                          obj.object_address
                        )
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        className: "button-ghost",
                        type: "button",
                      },
                      "Выбрать →"
                    )
                  );
                })
              )
            )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "select-period") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("select");
                setSelectedObject(null);
                setError(null);
              },
            },
            "← К выбору объекта"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Выбор периода"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement("span", { className: "badge" }, "Статистика")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { className: "form" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Начало периода",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "month",
              required: true,
              value: startMonth,
              onChange: function (e) {
                setStartMonth(e.target.value);
              },
              disabled: loading,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Конец периода",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "month",
              required: true,
              value: endMonth,
              onChange: function (e) {
                setEndMonth(e.target.value);
              },
              disabled: loading,
            })
          ),
          React.createElement(
            "button",
            {
              className: "button",
              type: "button",
              onClick: handleLoadStatistics,
              disabled: loading || !startMonth || !endMonth,
            },
            loading ? "Загрузка..." : "Показать статистику"
          )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "view" && statistics) {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("select-period");
                setStatistics(null);
                setError(null);
              },
            },
            "← Изменить период"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Статистика показаний"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement("span", { className: "badge" }, "Счётчиков: " + statistics.counters.length)
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { style: { overflowX: "auto", marginTop: "12px" } },
          React.createElement(
            "table",
            { 
              style: { 
                width: "100%", 
                borderCollapse: "collapse",
                fontSize: "12px"
              } 
            },
            React.createElement(
              "thead",
              null,
              React.createElement(
                "tr",
                null,
                React.createElement(
                  "th",
                  { 
                    style: { 
                      padding: "10px", 
                      textAlign: "left",
                      borderBottom: "2px solid rgba(148, 163, 184, 0.3)",
                      background: "rgba(56, 189, 248, 0.1)",
                      fontWeight: "600",
                      position: "sticky",
                      left: 0,
                      background: "rgba(15, 23, 42, 0.95)",
                      zIndex: 1
                    } 
                  },
                  "Счётчик"
                ),
                statistics.months.map(function(month) {
                  return React.createElement(
                    "th",
                    {
                      key: month.key,
                      style: {
                        padding: "10px",
                        textAlign: "center",
                        borderBottom: "2px solid rgba(148, 163, 184, 0.3)",
                        background: "rgba(56, 189, 248, 0.1)",
                        fontWeight: "600",
                        minWidth: "100px"
                      }
                    },
                    month.label
                  );
                })
              )
            ),
            React.createElement(
              "tbody",
              null,
              statistics.counters.map(function(counter) {
                return React.createElement(
                  "tr",
                  { key: counter.id },
                  React.createElement(
                    "td",
                    {
                      style: {
                        padding: "10px",
                        borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
                        fontWeight: "500",
                        position: "sticky",
                        left: 0,
                        background: "rgba(15, 23, 42, 0.95)",
                        zIndex: 1
                      }
                    },
                    counter.counter_type,
                    counter.counter_number ? React.createElement("span", { style: { color: "var(--text-muted)", fontSize: "11px" } }, " • № " + counter.counter_number) : null
                  ),
                  statistics.months.map(function(month) {
                    var value = statistics.data[counter.id][month.key];
                    return React.createElement(
                      "td",
                      {
                        key: month.key,
                        style: {
                          padding: "10px",
                          textAlign: "center",
                          borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
                          color: value !== null ? "var(--text-main)" : "var(--text-muted)"
                        }
                      },
                      value !== null ? value : "—"
                    );
                  })
                );
              })
            )
          )
        )
      );
    }

    return null;
  }

  function EditObjectScreen(props) {
    var searchQueryState = useState("");
    var searchQuery = searchQueryState[0];
    var setSearchQuery = searchQueryState[1];

    var objectsState = useState([]);
    var objects = objectsState[0];
    var setObjects = objectsState[1];

    var selectedObjectState = useState(null);
    var selectedObject = selectedObjectState[0];
    var setSelectedObject = selectedObjectState[1];

    var searchingState = useState(false);
    var searching = searchingState[0];
    var setSearching = searchingState[1];

    var stepState = useState("select");
    var step = stepState[0];
    var setStep = stepState[1];

    var objectNameState = useState("");
    var objectName = objectNameState[0];
    var setObjectName = objectNameState[1];

    var objectAddressState = useState("");
    var objectAddress = objectAddressState[0];
    var setObjectAddress = objectAddressState[1];

    var areaState = useState("");
    var area = areaState[0];
    var setArea = areaState[1];

    var contactsState = useState("");
    var contacts = contactsState[0];
    var setContacts = contactsState[1];

    var commentsState = useState("");
    var comments = commentsState[0];
    var setComments = commentsState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    var successMessageState = useState("");
    var successMessage = successMessageState[0];
    var setSuccessMessage = successMessageState[1];

    var selectedMonthState = useState("");
    var selectedMonth = selectedMonthState[0];
    var setSelectedMonth = selectedMonthState[1];

    var readingsState = useState([]);
    var readings = readingsState[0];
    var setReadings = readingsState[1];

    var editedReadingsState = useState({});
    var editedReadings = editedReadingsState[0];
    var setEditedReadings = editedReadingsState[1];

    var editedDatesState = useState({});
    var editedDates = editedDatesState[0];
    var setEditedDates = editedDatesState[1];

    var existingCountersState = useState([]);
    var existingCounters = existingCountersState[0];
    var setExistingCounters = existingCountersState[1];

    var selectedCountersState = useState({});
    var selectedCounters = selectedCountersState[0];
    var setSelectedCounters = selectedCountersState[1];

    var counterNumbersState = useState({});
    var counterNumbers = counterNumbersState[0];
    var setCounterNumbers = counterNumbersState[1];

    var assignedEmployeeIdState = useState("");
    var assignedEmployeeId = assignedEmployeeIdState[0];
    var setAssignedEmployeeId = assignedEmployeeIdState[1];

    var ownerIdState = useState("");
    var ownerId = ownerIdState[0];
    var setOwnerId = ownerIdState[1];

    var userListState = useState([]);
    var userList = userListState[0];
    var setUserList = userListState[1];

    useEffect(function () {
      supabase
        .from("employees")
        .select("id, first_name, last_name, email")
        .eq("role", "user")
        .eq("is_active", true)
        .order("first_name")
        .then(function (res) {
          if (!res.error && res.data) setUserList(res.data);
        });
    }, []);

    useEffect(function () {
      if (step === "select") {
        loadAllObjects();
      }
    }, [step]);

    function loadAllObjects() {
      setSearching(true);
      setError(null);

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка загрузки объектов");
            setSearching(false);
            return;
          }

          var sorted = result.data.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке объектов");
          setSearching(false);
        });
    }

    function handleSearch() {
      if (!searchQuery.trim()) {
        loadAllObjects();
        return;
      }

      setSearching(true);
      setError(null);

      var query = searchQuery.trim().toLowerCase();

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка поиска объектов");
            setSearching(false);
            return;
          }

          var filtered = result.data.filter(function (obj) {
            var name = (obj.object_name || "").toLowerCase();
            var address = (obj.object_address || "").toLowerCase();
            return name.indexOf(query) !== -1 || address.indexOf(query) !== -1;
          });

          var sorted = filtered.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);

          if (sorted.length === 0) {
            setError("Объекты не найдены. Попробуйте изменить запрос.");
          }
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при поиске объектов");
          setSearching(false);
        });
    }

    function handleSelectObject(obj) {
      setSelectedObject(obj);
      setObjectName(obj.object_name || "");
      setObjectAddress(obj.object_address || "");
      setArea(obj.area ? String(obj.area) : "");
      setContacts(obj.contacts || "");
      setComments(obj.comments || "");
      setAssignedEmployeeId(obj.assigned_employee_id ? String(obj.assigned_employee_id) : "");
      setOwnerId(obj.owner_id ? String(obj.owner_id) : "");
      setEditedReadings({});
      setEditedDates({});
      setSelectedMonth("");
      setReadings([]);
      setError(null);
      setSuccess(false);
      setSuccessMessage("");

      supabase
        .from("counters")
        .select("*")
        .eq("object_id", obj.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось загрузить счётчики объекта");
            setStep("select");
            return;
          }

          setExistingCounters(result.data || []);
          
          var selected = {};
          var numbers = {};
          
          for (var i = 0; i < result.data.length; i++) {
            var counter = result.data[i];
            selected[counter.counter_type] = true;
            if (counter.counter_number) {
              numbers[counter.counter_type] = counter.counter_number;
            }
          }
          
          setSelectedCounters(selected);
          setCounterNumbers(numbers);
          setStep("edit");
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке счётчиков");
          setStep("select");
        });
    }

    function handleUpdateObject(e) {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!objectName.trim() || !objectAddress.trim()) {
        setError("Название и адрес объекта обязательны.");
        return;
      }

      setSubmitting(true);

      var updateData = {
        object_name: objectName.trim(),
        object_address: objectAddress.trim(),
        area: area.trim() ? parseFloat(area) : null,
        contacts: contacts.trim() || null,
        comments: comments.trim() || null,
        assigned_employee_id: assignedEmployeeId ? parseInt(assignedEmployeeId, 10) : null,
        owner_id: ownerId && ownerId.trim() ? ownerId.trim() : null,
      };

      supabase
        .from("objects")
        .update(updateData)
        .eq("id", selectedObject.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось обновить объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          var counterPromises = [];
          
          for (var counterType in selectedCounters) {
            if (selectedCounters[counterType]) {
              var existingCounter = null;
              for (var i = 0; i < existingCounters.length; i++) {
                if (existingCounters[i].counter_type === counterType) {
                  existingCounter = existingCounters[i];
                  break;
                }
              }
              
              if (!existingCounter) {
                var newCounter = {
                  object_id: selectedObject.id,
                  counter_type: counterType,
                  counter_number: counterNumbers[counterType] ? counterNumbers[counterType].trim() : null,
                  is_active: true
                };
                
                counterPromises.push(
                  supabase.from("counters").insert([newCounter])
                );
              } else {
                var newNumber = counterNumbers[counterType] ? counterNumbers[counterType].trim() : null;
                var oldNumber = existingCounter.counter_number || null;
                
                if (newNumber !== oldNumber) {
                  counterPromises.push(
                    supabase
                      .from("counters")
                      .update({ counter_number: newNumber })
                      .eq("id", existingCounter.id)
                  );
                }
              }
            }
          }
          
          if (counterPromises.length === 0) {
            setSuccess(true);
            setSuccessMessage("Данные объекта успешно обновлены.");
            setSubmitting(false);
            setSelectedObject(Object.assign({}, selectedObject, updateData));
            return;
          }
          
          Promise.all(counterPromises)
            .then(function (counterResults) {
              var hasError = false;
              for (var i = 0; i < counterResults.length; i++) {
                if (counterResults[i].error) {
                  console.error("Counter update error:", counterResults[i].error);
                  hasError = true;
                }
              }
              
              if (hasError) {
                setError("Объект обновлён, но возникла ошибка при обновлении счётчиков");
                setSubmitting(false);
                return;
              }
              
              setSuccess(true);
              setSuccessMessage("Данные объекта и счётчиков успешно обновлены.");
              setSubmitting(false);
              setSelectedObject(Object.assign({}, selectedObject, updateData));
              
              supabase
                .from("counters")
                .select("*")
                .eq("object_id", selectedObject.id)
                .then(function (refreshResult) {
                  if (!refreshResult.error) {
                    setExistingCounters(refreshResult.data || []);
                  }
                });
            })
            .catch(function (err) {
              console.error("Counter save error:", err);
              setError("Объект обновлён, но ошибка при сохранении счётчиков");
              setSubmitting(false);
            });
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при обновлении объекта");
          setSubmitting(false);
        });
    }

    function handleArchiveObject() {
      if (!confirm("Перенести объект \"" + selectedObject.object_name + "\" в архив?")) {
        return;
      }

      setError(null);
      setSuccess(false);
      setSubmitting(true);

      supabase
        .from("objects")
        .update({ is_active: false })
        .eq("id", selectedObject.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось архивировать объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSuccessMessage("Объект перенесён в архив. Возврат в меню...");
          setSubmitting(false);
          
          setTimeout(function() {
            props.onNavigate("menu");
          }, 1500);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при архивировании объекта");
          setSubmitting(false);
        });
    }

    function handleGoToReadings() {
      setSelectedMonth("");
      setReadings([]);
      setEditedReadings({});
      setEditedDates({});
      setStep("select-month");
      setError(null);
      setSuccess(false);
      setSuccessMessage("");
    }

    function handleMonthSelect() {
      if (!selectedMonth) {
        setError("Выберите месяц");
        return;
      }

      setError(null);
      setSubmitting(true);

      var yearMonth = selectedMonth.split("-");
      var year = yearMonth[0];
      var month = yearMonth[1];
      var startDate = year + "-" + month + "-01";
      var nextMonth = parseInt(month) === 12 ? "01" : String(parseInt(month) + 1).padStart(2, "0");
      var nextYear = parseInt(month) === 12 ? String(parseInt(year) + 1) : year;
      var endDate = nextYear + "-" + nextMonth + "-01";

      supabase
        .from("counters")
        .select("id, counter_type, counter_number")
        .eq("object_id", selectedObject.id)
        .eq("is_active", true)
        .then(function (countersResult) {
          if (countersResult.error) {
            console.error(countersResult.error);
            setError("Ошибка загрузки счётчиков");
            setSubmitting(false);
            return;
          }

          var counterIds = countersResult.data.map(function (c) {
            return c.id;
          });

          return supabase
            .from("meter_readings")
            .select("*")
            .in("counter_id", counterIds)
            .gte("reading_date", startDate)
            .lt("reading_date", endDate)
            .then(function (readingsResult) {
              if (readingsResult.error) {
                console.error(readingsResult.error);
                setError("Ошибка загрузки показаний");
                setSubmitting(false);
                return;
              }

              var enrichedReadings = readingsResult.data.map(function (reading) {
                var counter = countersResult.data.find(function (c) {
                  return c.id === reading.counter_id;
                });
                return Object.assign({}, reading, {
                  counter_type: counter ? counter.counter_type : "",
                  counter_number: counter ? counter.counter_number : null,
                });
              });

              enrichedReadings.sort(function (a, b) {
                if (a.reading_date < b.reading_date) return -1;
                if (a.reading_date > b.reading_date) return 1;
                return 0;
              });

              setReadings(enrichedReadings);
              setEditedReadings({});
              setEditedDates({});
              setStep("edit-readings");
              setSubmitting(false);
            });
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке данных");
          setSubmitting(false);
        });
    }

    function handleReadingChange(readingId, newValue) {
      var updated = {};
      for (var key in editedReadings) {
        updated[key] = editedReadings[key];
      }
      updated[readingId] = newValue;
      setEditedReadings(updated);
    }

    function handleDateChange(readingId, newDate) {
      var updated = {};
      for (var key in editedDates) {
        updated[key] = editedDates[key];
      }
      updated[readingId] = newDate;
      setEditedDates(updated);
    }

    function handleSaveReadings() {
      setError(null);
      setSuccess(false);
      setSubmitting(true);

      var updatePromises = [];
      
      for (var i = 0; i < readings.length; i++) {
        var reading = readings[i];
        var updateData = {};
        var hasChanges = false;
        
        var currentValue = editedReadings[reading.id] !== undefined 
          ? editedReadings[reading.id] 
          : reading.indication;
        
        var currentDate = editedDates[reading.id] !== undefined 
          ? editedDates[reading.id] 
          : reading.reading_date;
        
        if (String(currentValue) !== String(reading.indication)) {
          updateData.indication = parseFloat(currentValue);
          hasChanges = true;
        }
        
        if (currentDate !== reading.reading_date) {
          updateData.reading_date = currentDate;
          hasChanges = true;
        }
        
        if (hasChanges) {
          console.log("Updating reading", reading.id, updateData);
          updatePromises.push(
            supabase
              .from("meter_readings")
              .update(updateData)
              .eq("id", reading.id)
          );
        }
      }

      if (updatePromises.length === 0) {
        setError("Нет изменений для сохранения");
        setSubmitting(false);
        return;
      }

      console.log("Sending", updatePromises.length, "updates");

      Promise.all(updatePromises)
        .then(function (results) {
          console.log("Update results:", results);
          var hasError = false;
          for (var i = 0; i < results.length; i++) {
            if (results[i].error) {
              hasError = true;
              console.error("Update error:", results[i].error);
            }
          }

          if (hasError) {
            setError("Не удалось обновить некоторые показания");
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSubmitting(false);
          setEditedReadings({});
          setEditedDates({});
          
          setTimeout(function() {
            handleMonthSelect();
          }, 500);
        })
        .catch(function (err) {
          console.error("Save error:", err);
          setError("Ошибка при сохранении показаний: " + err.message);
          setSubmitting(false);
        });
    }

    if (step === "select") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                props.onNavigate("menu");
              },
            },
            "← Назад в меню"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Редактировать объект"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              "Выберите объект для редактирования"
            )
          ),
          React.createElement("span", { className: "badge" }, "Редактирование")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          null,
          searching && objects.length === 0 && !error &&
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "12px" } },
              "⏳ Загрузка объектов..."
            ),
          React.createElement(
            "div",
            { className: "field-label" },
            "Поиск объекта"
          ),
          React.createElement(
            "div",
            { className: "hint", style: { marginBottom: "8px" } },
            "Введите название или адрес для поиска"
          ),
          React.createElement(
            "div",
            { style: { display: "flex", gap: "8px" } },
            React.createElement("input", {
              className: "input",
              type: "text",
              placeholder: "Поиск по названию или адресу",
              value: searchQuery,
              onChange: function (e) {
                setSearchQuery(e.target.value);
              },
              onKeyPress: function (e) {
                if (e.key === "Enter") {
                  handleSearch();
                }
              },
              disabled: searching,
            }),
            React.createElement(
              "button",
              {
                className: "button",
                type: "button",
                onClick: handleSearch,
                disabled: searching,
                style: { marginTop: 0 },
              },
              searching ? "Поиск..." : searchQuery.trim() ? "Найти" : "Обновить"
            ),
            searchQuery.trim() && React.createElement(
              "button",
              {
                className: "button-secondary button",
                type: "button",
                onClick: function () {
                  setSearchQuery("");
                  loadAllObjects();
                },
                disabled: searching,
                style: { marginTop: 0 },
              },
              "Очистить"
            )
          ),
          objects.length > 0 &&
            React.createElement(
              "div",
              { style: { marginTop: "16px" } },
              React.createElement(
                "div",
                { className: "field-label" },
                searchQuery.trim() 
                  ? "Найдено объектов: " + objects.length
                  : "Активных объектов: " + objects.length + " (отсортированы по алфавиту)"
              ),
              React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                objects.map(function (obj) {
                  return React.createElement(
                    "div",
                    {
                      key: obj.id,
                      className: "user-card",
                      onClick: function () {
                        handleSelectObject(obj);
                      },
                      style: { cursor: "pointer" },
                    },
                    React.createElement(
                      "div",
                      { className: "user-card-main" },
                      React.createElement(
                        "div",
                        { className: "user-meta" },
                        React.createElement(
                          "div",
                          { className: "user-name" },
                          obj.object_name
                        ),
                        React.createElement(
                          "div",
                          { className: "user-role" },
                          obj.object_address
                        )
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        className: "button-ghost",
                        type: "button",
                      },
                      "Редактировать →"
                    )
                  );
                })
              )
            )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "edit") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("select");
                setSelectedObject(null);
                setError(null);
                setSuccess(false);
              },
            },
            "← К списку объектов"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Редактирование объекта"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement("span", { className: "badge" }, "Данные объекта")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "form",
          { className: "form", onSubmit: handleUpdateObject },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Название объекта",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "text",
              required: true,
              placeholder: "Название объекта",
              value: objectName,
              onChange: function (e) {
                setObjectName(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Адрес объекта",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "text",
              required: true,
              placeholder: "Адрес объекта",
              value: objectAddress,
              onChange: function (e) {
                setObjectAddress(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Площадь (м²)"
            ),
            React.createElement("input", {
              className: "input",
              type: "number",
              step: "0.01",
              placeholder: "Площадь объекта",
              value: area,
              onChange: function (e) {
                setArea(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Контакты"
            ),
            React.createElement("textarea", {
              className: "input",
              rows: 2,
              placeholder: "ФИО, телефон, email ответственного лица",
              value: contacts,
              onChange: function (e) {
                setContacts(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Комментарии"
            ),
            React.createElement("textarea", {
              className: "input",
              rows: 2,
              placeholder: "Дополнительная информация",
              value: comments,
              onChange: function (e) {
                setComments(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Владелец (принадлежность объекта)"
            ),
            React.createElement(
              "select",
              {
                className: "input",
                value: ownerId,
                onChange: function (e) {
                  setOwnerId(e.target.value);
                },
                disabled: submitting,
              },
              React.createElement("option", { value: "" }, "— Не выбрано —"),
              (props.owners || []).map(function (o) {
                return React.createElement(
                  "option",
                  { key: o.id, value: o.id },
                  o.name
                );
              })
            )
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Закрепить за пользователем"
            ),
            React.createElement(
              "select",
              {
                className: "input",
                value: assignedEmployeeId,
                onChange: function (e) {
                  setAssignedEmployeeId(e.target.value);
                },
                disabled: submitting,
              },
              React.createElement("option", { value: "" }, "— Не назначен —"),
              userList.map(function (emp) {
                return React.createElement(
                  "option",
                  { key: emp.id, value: String(emp.id) },
                  (emp.first_name || "") + " " + (emp.last_name || "") + (emp.email ? " (" + emp.email + ")" : "")
                );
              })
            )
          ),
          React.createElement("div", { className: "divider" }),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Счётчики объекта"
            ),
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "12px" } },
              "Отметьте типы счётчиков, установленных на объекте. Список типов загружается из базы данных. Для каждого типа можно указать номер прибора учёта."
            ),
            !(props.counterTypes && props.counterTypes.length) ? React.createElement(
              "div",
              { className: "hint", style: { padding: "12px", color: "rgba(255,255,255,0.6)" } },
              "Типы счётчиков загружаются..."
            ) : React.createElement(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "12px" } },
              props.counterTypes.map(function (counterType) {
                return (function (type) {
                  return React.createElement(
                    "div",
                    { 
                      key: type,
                      style: { 
                        display: "flex", 
                        flexDirection: "column",
                        gap: "6px",
                        padding: "10px",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "6px",
                        background: selectedCounters[type] ? "rgba(59, 130, 246, 0.1)" : "transparent"
                      } 
                    },
                    React.createElement(
                      "label",
                      { 
                        style: { 
                          display: "flex", 
                          alignItems: "center", 
                          gap: "8px", 
                          cursor: "pointer",
                          userSelect: "none"
                        } 
                      },
                      React.createElement("input", {
                        type: "checkbox",
                        checked: selectedCounters[type] || false,
                        onChange: function (e) {
                          var newSelected = {};
                          for (var key in selectedCounters) {
                            newSelected[key] = selectedCounters[key];
                          }
                          newSelected[type] = e.target.checked;
                          setSelectedCounters(newSelected);
                        },
                        disabled: submitting,
                        style: { cursor: "pointer" }
                      }),
                      React.createElement("span", null, type)
                    ),
                    selectedCounters[type] && React.createElement(
                      "div",
                      { style: { marginLeft: "24px" } },
                      React.createElement(
                        "div",
                        { className: "hint", style: { marginBottom: "4px", fontSize: "11px" } },
                        "Номер прибора (необязательно)"
                      ),
                      React.createElement("input", {
                        className: "input",
                        type: "text",
                        placeholder: "Например: 12345678",
                        value: counterNumbers[type] || "",
                        onChange: function (e) {
                          var newNumbers = {};
                          for (var key in counterNumbers) {
                            newNumbers[key] = counterNumbers[key];
                          }
                          newNumbers[type] = e.target.value;
                          setCounterNumbers(newNumbers);
                        },
                        disabled: submitting,
                        style: { fontSize: "12px" }
                      })
                    )
                  );
                })(counterType);
              })
            )
          ),
          React.createElement("div", { className: "divider" }),
          React.createElement(
            "button",
            {
              className: "button",
              type: "submit",
              disabled: submitting,
            },
            submitting ? "Сохранение..." : "Сохранить изменения"
          )
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "10px" } },
          React.createElement(
            "button",
            {
              className: "button button-secondary",
              type: "button",
              onClick: handleGoToReadings,
              style: { width: "100%" },
            },
            "Перейти к редактированию показаний →"
          ),
          React.createElement(
            "button",
            {
              className: "button",
              type: "button",
              onClick: handleArchiveObject,
              disabled: submitting,
              style: { 
                width: "100%", 
                background: "linear-gradient(135deg, #dc2626, #991b1b)", 
                borderColor: "rgba(248, 113, 113, 0.9)" 
              },
            },
            submitting ? "Архивирование..." : "📦 Перенести в архив"
          )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          ),
        success &&
          React.createElement(
            "div",
            { className: "alert alert-success" },
            React.createElement("div", { className: "alert-icon" }, "✓"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement(
                "div",
                { className: "alert-title" },
                "Успешно"
              ),
              React.createElement(
                "div",
                { className: "alert-text" },
                successMessage || "Операция выполнена успешно."
              )
            )
          )
      );
    }

    if (step === "select-month") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("edit");
                setError(null);
              },
            },
            "← К данным объекта"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Выбор месяца"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement("span", { className: "badge" }, "Показания счётчиков")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Выберите месяц",
            React.createElement("span", null, "*")
          ),
          React.createElement(
            "div",
            { className: "hint", style: { marginBottom: "8px" } },
            "Будут показаны все показания счётчиков за выбранный месяц"
          ),
          React.createElement("input", {
            className: "input",
            type: "month",
            required: true,
            value: selectedMonth,
            onChange: function (e) {
              setSelectedMonth(e.target.value);
            },
            disabled: submitting,
          }),
          React.createElement(
            "button",
            {
              className: "button",
              type: "button",
              onClick: handleMonthSelect,
              disabled: submitting || !selectedMonth,
            },
            submitting ? "Загрузка..." : "Показать показания"
          )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "edit-readings") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setEditedReadings({});
                setEditedDates({});
                setStep("select-month");
                setError(null);
                setSuccess(false);
              },
            },
            "← Выбрать другой месяц"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Редактирование показаний"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name + " • " + selectedMonth
            )
          ),
          React.createElement("span", { className: "badge" }, "Всего записей: " + readings.length)
        ),
        React.createElement("div", { className: "divider" }),
        readings.length > 0
          ? React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "12px" } },
                readings.map(function (reading) {
                  var readingId = reading.id;
                  var counterType = reading.counter_type;
                  var counterNumber = reading.counter_number;
                  var originalDate = reading.reading_date;
                  var originalValue = reading.indication;
                  
                  return React.createElement(
                    "div",
                    {
                      key: readingId,
                      style: {
                        padding: "12px",
                        border: "1px solid rgba(148, 163, 184, 0.3)",
                        borderRadius: "10px",
                      },
                    },
                    React.createElement(
                      "div",
                      { className: "field-label" },
                      counterType,
                      counterNumber ? " • № " + counterNumber : ""
                    ),
                    React.createElement(
                      "div",
                      { style: { display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px", marginTop: "6px" } },
                      React.createElement(
                        "div",
                        null,
                        React.createElement(
                          "div",
                          { className: "field-label", style: { fontSize: "11px", marginBottom: "4px" } },
                          "Дата"
                        ),
                        React.createElement("input", {
                          className: "input",
                          type: "date",
                          value: editedDates[readingId] !== undefined 
                            ? editedDates[readingId] 
                            : originalDate,
                          onChange: (function(id) {
                            return function(e) {
                              handleDateChange(id, e.target.value);
                            };
                          })(readingId),
                          disabled: submitting,
                          style: { fontSize: "12px" },
                        })
                      ),
                      React.createElement(
                        "div",
                        null,
                        React.createElement(
                          "div",
                          { className: "field-label", style: { fontSize: "11px", marginBottom: "4px" } },
                          "Показание"
                        ),
                        React.createElement("input", {
                          className: "input",
                          type: "number",
                          step: "0.01",
                          placeholder: "Введите показание",
                          value: editedReadings[readingId] !== undefined 
                            ? editedReadings[readingId] 
                            : originalValue,
                          onChange: (function(id) {
                            return function(e) {
                              handleReadingChange(id, e.target.value);
                            };
                          })(readingId),
                          disabled: submitting,
                        })
                      )
                    )
                  );
                })
              ),
              React.createElement(
                "button",
                {
                  className: "button",
                  type: "button",
                  onClick: handleSaveReadings,
                  disabled: submitting,
                  style: { marginTop: "12px" },
                },
                submitting ? "Сохранение..." : "Сохранить изменения"
              )
            )
          : React.createElement(
              "div",
              { className: "alert alert-info" },
              React.createElement("div", { className: "alert-icon" }, "i"),
              React.createElement(
                "div",
                { className: "alert-body" },
                React.createElement(
                  "div",
                  { className: "alert-title" },
                  "Нет показаний"
                ),
                React.createElement(
                  "div",
                  { className: "alert-text" },
                  "За выбранный месяц нет внесённых показаний."
                )
              )
            ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          ),
        success &&
          React.createElement(
            "div",
            { className: "alert alert-success" },
            React.createElement("div", { className: "alert-icon" }, "✓"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement(
                "div",
                { className: "alert-title" },
                "Сохранено"
              ),
              React.createElement(
                "div",
                { className: "alert-text" },
                "Показания успешно обновлены."
              )
            )
          )
      );
    }
  }

  function ArchiveScreen(props) {
    var objectsState = useState([]);
    var objects = objectsState[0];
    var setObjects = objectsState[1];

    var selectedObjectState = useState(null);
    var selectedObject = selectedObjectState[0];
    var setSelectedObject = selectedObjectState[1];

    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var stepState = useState("list");
    var step = stepState[0];
    var setStep = stepState[1];

    var objectNameState = useState("");
    var objectName = objectNameState[0];
    var setObjectName = objectNameState[1];

    var objectAddressState = useState("");
    var objectAddress = objectAddressState[0];
    var setObjectAddress = objectAddressState[1];

    var areaState = useState("");
    var area = areaState[0];
    var setArea = areaState[1];

    var contactsState = useState("");
    var contacts = contactsState[0];
    var setContacts = contactsState[1];

    var commentsState = useState("");
    var comments = commentsState[0];
    var setComments = commentsState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    useEffect(function () {
      loadArchiveObjects();
    }, []);

    function loadArchiveObjects() {
      setLoading(true);
      setError(null);

      supabase
        .from("objects")
        .select("*")
        .eq("is_active", false)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка загрузки архивных объектов");
            setLoading(false);
            return;
          }

          var sorted = result.data.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setLoading(false);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке архива");
          setLoading(false);
        });
    }

    function handleSelectObject(obj) {
      setSelectedObject(obj);
      setObjectName(obj.object_name || "");
      setObjectAddress(obj.object_address || "");
      setArea(obj.area ? String(obj.area) : "");
      setContacts(obj.contacts || "");
      setComments(obj.comments || "");
      setStep("view");
      setError(null);
      setSuccess(false);
    }

    function handleUpdateObject(e) {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!objectName.trim() || !objectAddress.trim()) {
        setError("Название и адрес объекта обязательны.");
        return;
      }

      setSubmitting(true);

      var updateData = {
        object_name: objectName.trim(),
        object_address: objectAddress.trim(),
        area: area.trim() ? parseFloat(area) : null,
        contacts: contacts.trim() || null,
        comments: comments.trim() || null,
      };

      supabase
        .from("objects")
        .update(updateData)
        .eq("id", selectedObject.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось обновить объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSubmitting(false);
          setSelectedObject(Object.assign({}, selectedObject, updateData));
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при обновлении объекта");
          setSubmitting(false);
        });
    }

    function handleReactivate() {
      if (!confirm("Восстановить объект \"" + selectedObject.object_name + "\" из архива?")) {
        return;
      }

      setError(null);
      setSuccess(false);
      setSubmitting(true);

      supabase
        .from("objects")
        .update({ is_active: true })
        .eq("id", selectedObject.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось восстановить объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSubmitting(false);
          
          setTimeout(function() {
            setStep("list");
            setSelectedObject(null);
            loadArchiveObjects();
          }, 1000);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при восстановлении объекта");
          setSubmitting(false);
        });
    }

    if (step === "list") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                props.onNavigate("menu");
              },
            },
            "← Назад в меню"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Архив"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              "Неактивные объекты и их восстановление"
            )
          ),
          React.createElement("span", { className: "badge" }, "Блок 05")
        ),
        React.createElement("div", { className: "divider" }),
        loading
          ? React.createElement(
              "div",
              { className: "hint" },
              "⏳ Загрузка архивных объектов..."
            )
          : objects.length > 0
          ? React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { className: "field-label" },
                "Архивных объектов: " + objects.length + " (отсортированы по алфавиту)"
              ),
              React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" } },
                objects.map(function (obj) {
                  return React.createElement(
                    "div",
                    {
                      key: obj.id,
                      className: "user-card",
                      onClick: function () {
                        handleSelectObject(obj);
                      },
                      style: { cursor: "pointer", opacity: 0.8 },
                    },
                    React.createElement(
                      "div",
                      { className: "user-card-main" },
                      React.createElement(
                        "div",
                        { className: "user-meta" },
                        React.createElement(
                          "div",
                          { className: "user-name" },
                          obj.object_name
                        ),
                        React.createElement(
                          "div",
                          { className: "user-role" },
                          obj.object_address
                        )
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        className: "button-ghost",
                        type: "button",
                      },
                      "Просмотр →"
                    )
                  );
                })
              )
            )
          : React.createElement(
              "div",
              { className: "alert alert-info" },
              React.createElement("div", { className: "alert-icon" }, "i"),
              React.createElement(
                "div",
                { className: "alert-body" },
                React.createElement(
                  "div",
                  { className: "alert-title" },
                  "Архив пуст"
                ),
                React.createElement(
                  "div",
                  { className: "alert-text" },
                  "В архиве нет объектов. Все объекты активны."
                )
              )
            ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "view") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("list");
                setSelectedObject(null);
                setError(null);
                setSuccess(false);
              },
            },
            "← К списку архива"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Архивный объект"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement("span", { className: "badge" }, "Неактивен")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "form",
          { className: "form", onSubmit: handleUpdateObject },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Название объекта",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "text",
              required: true,
              placeholder: "Название объекта",
              value: objectName,
              onChange: function (e) {
                setObjectName(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Адрес объекта",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "text",
              required: true,
              placeholder: "Адрес объекта",
              value: objectAddress,
              onChange: function (e) {
                setObjectAddress(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Площадь (м²)"
            ),
            React.createElement("input", {
              className: "input",
              type: "number",
              step: "0.01",
              placeholder: "Площадь объекта",
              value: area,
              onChange: function (e) {
                setArea(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Контакты"
            ),
            React.createElement("textarea", {
              className: "input",
              rows: 2,
              placeholder: "ФИО, телефон, email ответственного лица",
              value: contacts,
              onChange: function (e) {
                setContacts(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Комментарии"
            ),
            React.createElement("textarea", {
              className: "input",
              rows: 2,
              placeholder: "Дополнительная информация",
              value: comments,
              onChange: function (e) {
                setComments(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "button",
            {
              className: "button",
              type: "submit",
              disabled: submitting,
            },
            submitting ? "Сохранение..." : "Сохранить изменения"
          )
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "button",
          {
            className: "button button-secondary",
            type: "button",
            onClick: handleReactivate,
            disabled: submitting,
            style: { width: "100%", background: "linear-gradient(135deg, #22c55e, #16a34a)", borderColor: "rgba(74, 222, 128, 0.9)" },
          },
          submitting ? "Восстановление..." : "↻ Восстановить объект"
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          ),
        success &&
          React.createElement(
            "div",
            { className: "alert alert-success" },
            React.createElement("div", { className: "alert-icon" }, "✓"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement(
                "div",
                { className: "alert-title" },
                "Успешно"
              ),
              React.createElement(
                "div",
                { className: "alert-text" },
                "Объект восстановлен и теперь активен."
              )
            )
          )
      );
    }
  }

  function UserManagementScreen(props) {
    var viewModeState = useState("create");
    var viewMode = viewModeState[0];
    var setViewMode = viewModeState[1];

    var emailState = useState("");
    var passwordState = useState("");
    var firstNameState = useState("");
    var lastNameState = useState("");
    var maxIdState = useState("");
    var phoneState = useState("");
    var notifyViaEmailState = useState(false);
    var notifyViaTelegramState = useState(false);
    var notifyViaMaxState = useState(false);
    var roleState = useState("user");
    var submittingState = useState(false);
    var errorState = useState(null);
    var successState = useState(null);
    var createdCredentialsState = useState(null);
    var objectsState = useState([]);
    var selectedObjectIdsState = useState({});
    var email = emailState[0];
    var setEmail = emailState[1];
    var password = passwordState[0];
    var setPassword = passwordState[1];
    var firstName = firstNameState[0];
    var setFirstName = firstNameState[1];
    var lastName = lastNameState[0];
    var setLastName = lastNameState[1];
    var maxId = maxIdState[0];
    var setMaxId = maxIdState[1];
    var phone = phoneState[0];
    var setPhone = phoneState[1];
    var notifyViaEmail = notifyViaEmailState[0];
    var setNotifyViaEmail = notifyViaEmailState[1];
    var notifyViaTelegram = notifyViaTelegramState[0];
    var setNotifyViaTelegram = notifyViaTelegramState[1];
    var notifyViaMax = notifyViaMaxState[0];
    var setNotifyViaMax = notifyViaMaxState[1];
    var role = roleState[0];
    var setRole = roleState[1];
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];
    var error = errorState[0];
    var setError = errorState[1];
    var success = successState[0];
    var setSuccess = successState[1];
    var createdCredentials = createdCredentialsState[0];
    var setCreatedCredentials = createdCredentialsState[1];
    var copiedToClipboardState = useState(false);
    var copiedToClipboard = copiedToClipboardState[0];
    var setCopiedToClipboard = copiedToClipboardState[1];
    var objects = objectsState[0];
    var setObjects = objectsState[1];
    var selectedObjectIds = selectedObjectIdsState[0];
    var setSelectedObjectIds = selectedObjectIdsState[1];

    var employeesListState = useState([]);
    var selectedEmployeeIdState = useState("");
    var editEmailState = useState("");
    var editPasswordState = useState("");
    var editFirstNameState = useState("");
    var editLastNameState = useState("");
    var editMaxIdState = useState("");
    var editPhoneState = useState("");
    var editNotifyViaEmailState = useState(false);
    var editNotifyViaTelegramState = useState(false);
    var editNotifyViaMaxState = useState(false);
    var editRoleState = useState("user");
    var editObjectsState = useState([]);
    var editSelectedObjectIdsState = useState({});
    var editSubmittingState = useState(false);
    var editErrorState = useState(null);
    var editSuccessState = useState(null);
    var editUserSearchState = useState("");
    var employeesList = employeesListState[0];
    var setEmployeesList = employeesListState[1];
    var selectedEmployeeId = selectedEmployeeIdState[0];
    var setSelectedEmployeeId = selectedEmployeeIdState[1];
    var editUserSearch = editUserSearchState[0];
    var setEditUserSearch = editUserSearchState[1];
    var editEmail = editEmailState[0];
    var setEditEmail = editEmailState[1];
    var editPassword = editPasswordState[0];
    var setEditPassword = editPasswordState[1];
    var editFirstName = editFirstNameState[0];
    var setEditFirstName = editFirstNameState[1];
    var editLastName = editLastNameState[0];
    var setEditLastName = editLastNameState[1];
    var editMaxId = editMaxIdState[0];
    var setEditMaxId = editMaxIdState[1];
    var editPhone = editPhoneState[0];
    var setEditPhone = editPhoneState[1];
    var editNotifyViaEmail = editNotifyViaEmailState[0];
    var setEditNotifyViaEmail = editNotifyViaEmailState[1];
    var editNotifyViaTelegram = editNotifyViaTelegramState[0];
    var setEditNotifyViaTelegram = editNotifyViaTelegramState[1];
    var editNotifyViaMax = editNotifyViaMaxState[0];
    var setEditNotifyViaMax = editNotifyViaMaxState[1];
    var editRole = editRoleState[0];
    var setEditRole = editRoleState[1];
    var editObjects = editObjectsState[0];
    var setEditObjects = editObjectsState[1];
    var editSelectedObjectIds = editSelectedObjectIdsState[0];
    var setEditSelectedObjectIds = editSelectedObjectIdsState[1];
    var editSubmitting = editSubmittingState[0];
    var setEditSubmitting = editSubmittingState[1];
    var editError = editErrorState[0];
    var setEditError = editErrorState[1];
    var editSuccess = editSuccessState[0];
    var setEditSuccess = editSuccessState[1];

    useEffect(function () {
      if (viewMode !== "create") return;
      supabase
        .from("objects")
        .select("id, object_name, object_address")
        .eq("is_active", true)
        .is("assigned_employee_id", null)
        .order("object_name")
        .then(function (res) {
          if (!res.error && res.data) setObjects(res.data);
        });
    }, [viewMode]);

    useEffect(function () {
      if (viewMode !== "edit") return;
      supabase
        .from("employees")
        .select("id, email, first_name, last_name, role")
        .eq("is_active", true)
        .order("first_name")
        .then(function (res) {
          if (!res.error && res.data) {
            setEmployeesList(res.data);
          } else if (res.error) {
            console.error("Employees list load error:", res.error);
            setEmployeesList([]);
          }
        })
        .catch(function (err) {
          console.error("Employees list fetch failed:", err);
          setEmployeesList([]);
        });
    }, [viewMode]);

    useEffect(function () {
      if (viewMode !== "edit" || !selectedEmployeeId) {
        setEditObjects([]);
        setEditSelectedObjectIds({});
        return;
      }
      var eid = parseInt(selectedEmployeeId, 10);
      if (!eid) return;
      function fillEditForm(emp) {
        setEditEmail(emp.email || "");
        setEditFirstName(emp.first_name || "");
        setEditLastName(emp.last_name || "");
        setEditMaxId(emp.max_id != null ? emp.max_id : "");
        setEditPhone(emp.phone != null ? emp.phone : "");
        setEditNotifyViaEmail(!!emp.notify_via_email);
        setEditNotifyViaTelegram(!!emp.notify_via_telegram);
        setEditNotifyViaMax(!!emp.notify_via_max);
        setEditRole(emp.role || "user");
        setEditPassword("");
      }
      supabase
        .from("employees")
        .select("id, email, first_name, last_name, role, max_id, phone, notify_via_email, notify_via_telegram, notify_via_max")
        .eq("id", eid)
        .eq("is_active", true)
        .single()
        .then(function (empRes) {
          if (!empRes.error && empRes.data) {
            fillEditForm(empRes.data);
          } else if (empRes.error) {
            supabase
              .from("employees")
              .select("id, email, first_name, last_name, role")
              .eq("id", eid)
              .eq("is_active", true)
              .single()
              .then(function (fallbackRes) {
                if (!fallbackRes.error && fallbackRes.data) {
                  fillEditForm(fallbackRes.data);
                }
              });
          }
        });
      supabase
        .from("objects")
        .select("id, object_name, object_address, assigned_employee_id")
        .eq("is_active", true)
        .or("assigned_employee_id.is.null,assigned_employee_id.eq." + eid)
        .order("object_name")
        .then(function (res) {
          if (!res.error && res.data) {
            setEditObjects(res.data);
            var checked = {};
            res.data.forEach(function (o) {
              if (o.assigned_employee_id === eid) checked[o.id] = true;
            });
            setEditSelectedObjectIds(checked);
          }
        });
    }, [viewMode, selectedEmployeeId]);

    function toggleObject(id) {
      var next = Object.assign({}, selectedObjectIds);
      next[id] = !next[id];
      setSelectedObjectIds(next);
    }

    function copyCredentialsToClipboard() {
      if (!createdCredentials) return;
      var text = "Данные для доступа:\nEmail: " + createdCredentials.email + "\nПароль: " + createdCredentials.password;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          setCopiedToClipboard(true);
          setTimeout(function () { setCopiedToClipboard(false); }, 2000);
        });
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          setCopiedToClipboard(true);
          setTimeout(function () { setCopiedToClipboard(false); }, 2000);
        } catch (e) {}
        document.body.removeChild(ta);
      }
    }

    function toggleEditObject(id) {
      var next = Object.assign({}, editSelectedObjectIds);
      next[id] = !next[id];
      setEditSelectedObjectIds(next);
    }

    function handleEditSubmit(e) {
      e.preventDefault();
      setEditError(null);
      setEditSuccess(null);
      if (!selectedEmployeeId) {
        setEditError("Выберите пользователя.");
        return;
      }
      var eid = parseInt(selectedEmployeeId, 10);
      if (!eid) return;
      if (!editEmail.trim() || !editFirstName.trim()) {
        setEditError("Заполните email и имя.");
        return;
      }
      if (editPassword.length > 0 && editPassword.length < 6) {
        setEditError("Пароль не менее 6 символов.");
        return;
      }
      var phoneResult = normalizePhoneForRussia(editPhone);
      if (!phoneResult.valid) {
        setEditError("Телефон: укажите +7 и 10 цифр (без пробелов и символов).");
        return;
      }
      var token = props.session && props.session.access_token;
      if (!token) {
        setEditError("Нет сессии. Войдите заново.");
        return;
      }
      var objectIds = editRole === "user" ? editObjects.filter(function (o) { return editSelectedObjectIds[o.id]; }).map(function (o) { return o.id; }) : [];
      setEditSubmitting(true);
      var body = {
        employee_id: eid,
        email: editEmail.trim(),
        first_name: editFirstName.trim(),
        last_name: editLastName.trim() || undefined,
        role: editRole,
        object_ids: objectIds,
        max_id: editMaxId.trim() ? editMaxId.trim() : null,
        phone: phoneResult.normalized,
        notify_via_email: editNotifyViaEmail,
        notify_via_telegram: editNotifyViaTelegram,
        notify_via_max: editNotifyViaMax,
      };
      if (editPassword.length >= 6) body.password = editPassword;
      fetch(SUPABASE_URL + "/functions/v1/admin-update-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify(body),
      })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (_ref) {
          var status = _ref.status;
          var data = _ref.data;
          setEditSubmitting(false);
          if (status >= 200 && status < 300) {
            setEditSuccess(data.message || "Параметры сохранены.");
          } else {
            setEditError(data.error || "Ошибка сохранения.");
          }
        })
        .catch(function (err) {
          setEditSubmitting(false);
          setEditError(err.message || "Ошибка сети.");
        });
    }

    function handleDeactivateUser() {
      if (!selectedEmployeeId) {
        setEditError("Выберите пользователя.");
        return;
      }
      
      var eid = parseInt(selectedEmployeeId, 10);
      if (!eid) return;
      
      // Нельзя деактивировать самого себя
      if (eid === props.employee.id) {
        setEditError("Вы не можете деактивировать свой собственный аккаунт.");
        return;
      }
      
      if (!confirm("Деактивировать этого пользователя? Он не сможет войти в систему.")) {
        return;
      }
      
      setEditError(null);
      setEditSuccess(null);
      setEditSubmitting(true);
      
      supabase
        .from("employees")
        .update({ is_active: false })
        .eq("id", eid)
        .then(function (result) {
          setEditSubmitting(false);
          if (result.error) {
            console.error(result.error);
            setEditError("Не удалось деактивировать пользователя: " + result.error.message);
            return;
          }
          
          setEditSuccess("Пользователь деактивирован.");
          
          // Очистить выбор через 1.5 секунды
          setTimeout(function() {
            setSelectedEmployeeId(null);
            setEditEmail("");
            setEditPassword("");
            setEditFirstName("");
            setEditLastName("");
            setEditMaxId("");
            setEditPhone("");
            setEditNotifyViaEmail(false);
            setEditNotifyViaTelegram(false);
            setEditNotifyViaMax(false);
            setEditRole("user");
            setEditSelectedObjectIds({});
            setEditSuccess(null);
          }, 1500);
        })
        .catch(function (err) {
          console.error(err);
          setEditSubmitting(false);
          setEditError("Ошибка деактивации пользователя.");
        });
    }

    function handleSubmit(e) {
      e.preventDefault();
      setError(null);
      setSuccess(null);
      setCreatedCredentials(null);
      if (!email.trim() || !password || !firstName.trim()) {
        setError("Заполните email, пароль и имя.");
        return;
      }
      if (password.length < 6) {
        setError("Пароль не менее 6 символов.");
        return;
      }
      var phoneResult = normalizePhoneForRussia(phone);
      if (!phoneResult.valid) {
        setError("Телефон: укажите +7 и 10 цифр (без пробелов и символов).");
        return;
      }
      var token = props.session && props.session.access_token;
      if (!token) {
        setError("Нет сессии. Войдите заново.");
        return;
      }
      var objectIds = role === "user" ? objects.filter(function (o) { return selectedObjectIds[o.id]; }).map(function (o) { return o.id; }) : [];
      setSubmitting(true);
      fetch(SUPABASE_URL + "/functions/v1/admin-create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
          first_name: firstName.trim(),
          last_name: lastName.trim() || undefined,
          role: role,
          object_ids: objectIds.length ? objectIds : undefined,
          max_id: maxId.trim() ? maxId.trim() : undefined,
          phone: phoneResult.normalized || undefined,
          notify_via_email: notifyViaEmail,
          notify_via_telegram: notifyViaTelegram,
          notify_via_max: notifyViaMax,
        }),
      })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (_ref) {
          var status = _ref.status;
          var data = _ref.data;
          setSubmitting(false);
          if (status >= 200 && status < 300) {
            setCreatedCredentials({ email: email.trim(), password: password });
            setSuccess(data.message || "Пользователь создан.");
            setEmail("");
            setPassword("");
            setFirstName("");
            setLastName("");
            setMaxId("");
            setPhone("");
            setNotifyViaEmail(false);
            setNotifyViaTelegram(false);
            setNotifyViaMax(false);
            setRole("user");
            setSelectedObjectIds({});
          } else {
            setError(data.error || "Ошибка создания пользователя.");
          }
        })
        .catch(function (err) {
          setSubmitting(false);
          setError(err.message || "Ошибка сети.");
        });
    }

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { className: "top-bar" },
        React.createElement(
          "button",
          { className: "back-button", onClick: function () { props.onNavigate("menu"); } },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "panel-title" }, "Управление пользователями"),
          React.createElement("div", { className: "panel-subtitle" }, "Создание учётной записи и назначение роли")
        ),
        React.createElement("span", { className: "badge" }, "Шаг 4")
      ),
      React.createElement("div", { className: "divider" }),
      React.createElement(
        "div",
        { style: { marginBottom: "16px", maxWidth: "400px" } },
        viewMode === "create"
          ? React.createElement(
              "button",
              {
                type: "button",
                className: "button",
                onClick: function () { setViewMode("edit"); setError(null); setSuccess(null); setEditError(null); setEditSuccess(null); setSelectedEmployeeId(""); setEditUserSearch(""); },
              },
              "Изменить пользователя"
            )
          : React.createElement(
              "button",
              {
                type: "button",
                className: "button primary",
                onClick: function () { setViewMode("create"); setError(null); setSuccess(null); setEditError(null); setEditSuccess(null); },
              },
              "Создать учётную запись"
            )
      ),
      viewMode === "create" && React.createElement(
        "form",
        { className: "form", onSubmit: handleSubmit, style: { maxWidth: "400px" } },
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Email (логин)", React.createElement("span", null, "*")),
          React.createElement("input", {
            className: "input",
            type: "email",
            required: true,
            value: email,
            onChange: function (e) { setEmail(e.target.value); },
            disabled: submitting,
            placeholder: "user@example.com",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Пароль", React.createElement("span", null, "*")),
          React.createElement("input", {
            className: "input",
            type: "password",
            required: true,
            minLength: 6,
            value: password,
            onChange: function (e) { setPassword(e.target.value); },
            disabled: submitting,
            placeholder: "Не менее 6 символов",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Имя", React.createElement("span", null, "*")),
          React.createElement("input", {
            className: "input",
            type: "text",
            required: true,
            value: firstName,
            onChange: function (e) { setFirstName(e.target.value); },
            disabled: submitting,
            placeholder: "Имя",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Фамилия"),
          React.createElement("input", {
            className: "input",
            type: "text",
            value: lastName,
            onChange: function (e) { setLastName(e.target.value); },
            disabled: submitting,
            placeholder: "Фамилия",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Max ID"),
          React.createElement("input", {
            className: "input",
            type: "text",
            value: maxId,
            onChange: function (e) { setMaxId(e.target.value); },
            disabled: submitting,
            placeholder: "Необязательно",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Телефон"),
          React.createElement("input", {
            className: "input",
            type: "tel",
            value: phone,
            onChange: function (e) { setPhone(e.target.value); },
            disabled: submitting,
            placeholder: "+7 и 10 цифр, например +79991234567",
          }),
          React.createElement("div", { className: "hint", style: { marginTop: "4px" } }, "Только +7 и цифры, без пробелов и символов. Сохраняется в формате +79991234567.")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement("div", { className: "field-label" }, "Получать объявления по контактам"),
        React.createElement("div", { className: "hint", style: { marginBottom: "8px" } }, "Отметьте каналы для объявлений. При включении отображается индикатор."),
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "10px" } },
          React.createElement(
            "label",
            { style: { display: "flex", alignItems: "center", gap: "10px", cursor: submitting ? "default" : "pointer", flexWrap: "wrap" } },
            React.createElement("input", { type: "checkbox", checked: notifyViaEmail, onChange: function () { if (!submitting) setNotifyViaEmail(!notifyViaEmail); }, disabled: submitting }),
            React.createElement("span", { style: { flex: 1 } }, "По Email"),
            React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, email || "—"),
            notifyViaEmail && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
          ),
          React.createElement(
            "label",
            { style: { display: "flex", alignItems: "center", gap: "10px", cursor: submitting ? "default" : "pointer", flexWrap: "wrap" } },
            React.createElement("input", { type: "checkbox", checked: notifyViaTelegram, onChange: function () { if (!submitting) setNotifyViaTelegram(!notifyViaTelegram); }, disabled: submitting }),
            React.createElement("span", { style: { flex: 1 } }, "По Telegram"),
            React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, "привязывается в боте"),
            notifyViaTelegram && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
          ),
          React.createElement(
            "label",
            { style: { display: "flex", alignItems: "center", gap: "10px", cursor: submitting ? "default" : "pointer", flexWrap: "wrap" } },
            React.createElement("input", { type: "checkbox", checked: notifyViaMax, onChange: function () { if (!submitting) setNotifyViaMax(!notifyViaMax); }, disabled: submitting }),
            React.createElement("span", { style: { flex: 1 } }, "По Max ID"),
            React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, maxId || "—"),
            notifyViaMax && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
          )
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label", style: { marginBottom: "8px" } }, "Роль"),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "10px 12px",
                borderRadius: "12px",
                border: "1px solid rgba(148, 163, 184, 0.4)",
                background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
                color: "#e5e7eb",
              },
            },
            React.createElement(
              "label",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  cursor: submitting ? "default" : "pointer",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  background: role === "user" ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                },
              },
              React.createElement("input", {
                type: "checkbox",
                checked: role === "user",
                onChange: function () { if (!submitting) setRole("user"); },
                disabled: submitting,
                style: { flexShrink: 0 },
              }),
              React.createElement("span", { style: { fontWeight: 500 } }, "Пользователь")
            ),
            React.createElement(
              "label",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  cursor: submitting ? "default" : "pointer",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  background: role === "owner" ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                },
              },
              React.createElement("input", {
                type: "checkbox",
                checked: role === "owner",
                onChange: function () { if (!submitting) setRole("owner"); },
                disabled: submitting,
                style: { flexShrink: 0 },
              }),
              React.createElement("span", { style: { fontWeight: 500 } }, "Владелец")
            )
          )
        ),
        role === "user" && objects.length > 0 && React.createElement(
          "div",
          { style: { marginTop: "16px" } },
          React.createElement("div", { className: "field-label", style: { marginBottom: "8px" } }, "Объекты для пользователя (выберите один или несколько)"),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                maxHeight: "220px",
                overflowY: "auto",
                padding: "10px 12px",
                borderRadius: "12px",
                border: "1px solid rgba(148, 163, 184, 0.4)",
                background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
                color: "#e5e7eb",
              },
            },
            objects.map(function (obj) {
              var name = obj.object_name || "Объект #" + obj.id;
              var address = obj.object_address ? String(obj.object_address).trim() : "";
              return React.createElement(
                "label",
                {
                  key: obj.id,
                  style: {
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    cursor: submitting ? "default" : "pointer",
                    padding: "8px 10px",
                    borderRadius: "10px",
                    background: "rgba(15, 23, 42, 0.6)",
                    border: "1px solid rgba(148, 163, 184, 0.25)",
                  },
                },
                React.createElement("input", {
                  type: "checkbox",
                  checked: !!selectedObjectIds[obj.id],
                  onChange: function () { toggleObject(obj.id); },
                  disabled: submitting,
                  style: { marginTop: "3px", flexShrink: 0 },
                }),
                React.createElement(
                  "div",
                  { style: { flex: 1, minWidth: 0 } },
                  React.createElement("div", { style: { fontSize: "13px", fontWeight: 500, color: "#e5e7eb" } }, name),
                  address ? React.createElement("div", { style: { fontSize: "12px", color: "#9ca3af", marginTop: "2px" } }, address) : null
                )
              );
            })
          )
        ),
        React.createElement(
          "button",
          { className: "button", type: "submit", disabled: submitting },
          submitting ? "Создание..." : "Создать учётную запись"
        )
      ),
      viewMode === "edit" && React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { style: { marginBottom: "16px" } },
          React.createElement("div", { className: "field-label" }, "Поиск пользователя"),
          React.createElement(
            "div",
            { className: "hint", style: { marginBottom: "8px" } },
            "Введите имя, email или роль для поиска, или оставьте пустым для отображения всех пользователей"
          ),
          React.createElement(
            "div",
            { style: { display: "flex", gap: "8px" } },
            React.createElement("input", {
              className: "input",
              type: "text",
              placeholder: "Поиск по имени, email или роли",
              value: editUserSearch,
              onChange: function (e) { setEditUserSearch(e.target.value); },
              disabled: editSubmitting,
            }),
            React.createElement(
              "button",
              {
                className: "button",
                type: "button",
                onClick: function () { setEditUserSearch(""); },
                disabled: editSubmitting,
                style: { marginTop: 0 },
              },
              editUserSearch.trim() ? "Очистить" : "Обновить"
            )
          )
        ),
        (function () {
          var q = (editUserSearch || "").trim().toLowerCase();
          var filtered = q
            ? employeesList.filter(function (emp) {
                var name = ((emp.first_name || "") + " " + (emp.last_name || "")).trim().toLowerCase();
                var email = (emp.email || "").toLowerCase();
                var roleStr = (emp.role === "owner" ? "владелец" : "пользователь");
                return name.indexOf(q) >= 0 || email.indexOf(q) >= 0 || roleStr.indexOf(q) >= 0;
              })
            : employeesList;
          return filtered.length > 0
            ? React.createElement(
                "div",
                { style: { marginBottom: "20px" } },
                React.createElement(
                  "div",
                  { className: "field-label" },
                  q ? "Найдено пользователей: " + filtered.length : "Пользователей: " + filtered.length + " (отсортированы по алфавиту)"
                ),
                React.createElement(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                  filtered.map(function (emp) {
                    var name = (emp.first_name || "") + " " + (emp.last_name || "").trim();
                    var sub = (emp.email || "") + " — " + (emp.role === "owner" ? "Владелец" : "Пользователь");
                    var isSelected = String(emp.id) === selectedEmployeeId;
                    return React.createElement(
                      "div",
                      {
                        key: emp.id,
                        className: "user-card",
                        onClick: function () { setSelectedEmployeeId(isSelected ? "" : String(emp.id)); },
                        style: { cursor: "pointer" },
                      },
                      React.createElement(
                        "div",
                        { className: "user-card-main" },
                        React.createElement(
                          "div",
                          { className: "user-meta" },
                          React.createElement("div", { className: "user-name" }, name || "—"),
                          React.createElement("div", { className: "user-role" }, sub)
                        )
                      ),
                      React.createElement(
                        "button",
                        {
                          className: "button-ghost",
                          type: "button",
                          onClick: function (e) {
                            e.stopPropagation();
                            setSelectedEmployeeId(isSelected ? "" : String(emp.id));
                          },
                        },
                        isSelected ? "Отменить выбор" : "Выбрать →"
                      )
                    );
                  })
                )
              )
            : React.createElement(
                "div",
                { style: { marginBottom: "20px", padding: "12px", color: "var(--text-muted)", fontSize: "13px" } },
                "Никого не найдено. Измените запрос или очистите поиск."
              );
        })(),
        React.createElement(
          "form",
          { className: "form", onSubmit: handleEditSubmit, style: { maxWidth: "400px" } },
          selectedEmployeeId && React.createElement(
            "div",
            null,
            React.createElement(
              "button",
              {
                type: "button",
                className: "button-ghost",
                onClick: function () { setSelectedEmployeeId(""); },
                style: { marginBottom: "12px", padding: "4px 0" },
              },
              "← Выбрать другого пользователя"
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Email (логин)", React.createElement("span", null, "*")),
              React.createElement("input", {
                className: "input",
                type: "email",
                required: true,
                value: editEmail,
                onChange: function (e) { setEditEmail(e.target.value); },
                disabled: editSubmitting,
                placeholder: "user@example.com",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Новый пароль (оставьте пустым, чтобы не менять)"),
              React.createElement("input", {
                className: "input",
                type: "password",
                value: editPassword,
                onChange: function (e) { setEditPassword(e.target.value); },
                disabled: editSubmitting,
                placeholder: "Не менее 6 символов",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Имя", React.createElement("span", null, "*")),
              React.createElement("input", {
                className: "input",
                type: "text",
                required: true,
                value: editFirstName,
                onChange: function (e) { setEditFirstName(e.target.value); },
                disabled: editSubmitting,
                placeholder: "Имя",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Фамилия"),
              React.createElement("input", {
                className: "input",
                type: "text",
                value: editLastName,
                onChange: function (e) { setEditLastName(e.target.value); },
                disabled: editSubmitting,
                placeholder: "Фамилия",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Max ID"),
              React.createElement("input", {
                className: "input",
                type: "text",
                value: editMaxId,
                onChange: function (e) { setEditMaxId(e.target.value); },
                disabled: editSubmitting,
                placeholder: "Необязательно",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Телефон"),
              React.createElement("input", {
                className: "input",
                type: "tel",
                value: editPhone,
                onChange: function (e) { setEditPhone(e.target.value); },
                disabled: editSubmitting,
                placeholder: "+7 и 10 цифр, например +79991234567",
              }),
              React.createElement("div", { className: "hint", style: { marginTop: "4px" } }, "Только +7 и цифры. Сохраняется в формате +79991234567.")
            ),
            React.createElement("div", { className: "divider" }),
            React.createElement("div", { className: "field-label" }, "Получать объявления по контактам"),
            React.createElement("div", { className: "hint", style: { marginBottom: "8px" } }, "Отметьте каналы для объявлений. При включении отображается индикатор."),
            React.createElement(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "10px" } },
              React.createElement(
                "label",
                { style: { display: "flex", alignItems: "center", gap: "10px", cursor: editSubmitting ? "default" : "pointer", flexWrap: "wrap" } },
                React.createElement("input", { type: "checkbox", checked: editNotifyViaEmail, onChange: function () { if (!editSubmitting) setEditNotifyViaEmail(!editNotifyViaEmail); }, disabled: editSubmitting }),
                React.createElement("span", { style: { flex: 1 } }, "По Email"),
                React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, editEmail || "—"),
                editNotifyViaEmail && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
              ),
              React.createElement(
                "label",
                { style: { display: "flex", alignItems: "center", gap: "10px", cursor: editSubmitting ? "default" : "pointer", flexWrap: "wrap" } },
                React.createElement("input", { type: "checkbox", checked: editNotifyViaTelegram, onChange: function () { if (!editSubmitting) setEditNotifyViaTelegram(!editNotifyViaTelegram); }, disabled: editSubmitting }),
                React.createElement("span", { style: { flex: 1 } }, "По Telegram"),
                React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, "привязывается в боте"),
                editNotifyViaTelegram && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
              ),
              React.createElement(
                "label",
                { style: { display: "flex", alignItems: "center", gap: "10px", cursor: editSubmitting ? "default" : "pointer", flexWrap: "wrap" } },
                React.createElement("input", { type: "checkbox", checked: editNotifyViaMax, onChange: function () { if (!editSubmitting) setEditNotifyViaMax(!editNotifyViaMax); }, disabled: editSubmitting }),
                React.createElement("span", { style: { flex: 1 } }, "По Max ID"),
                React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, editMaxId || "—"),
                editNotifyViaMax && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
              )
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label", style: { marginBottom: "8px" } }, "Роль"),
              React.createElement(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    padding: "10px 12px",
                    borderRadius: "12px",
                    border: "1px solid rgba(148, 163, 184, 0.4)",
                    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
                    color: "#e5e7eb",
                  },
                },
                React.createElement(
                  "label",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      cursor: editSubmitting ? "default" : "pointer",
                      padding: "8px 10px",
                      borderRadius: "10px",
                      background: editRole === "user" ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
                      border: "1px solid rgba(148, 163, 184, 0.25)",
                    },
                  },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: editRole === "user",
                    onChange: function () { if (!editSubmitting) setEditRole("user"); },
                    disabled: editSubmitting,
                    style: { flexShrink: 0 },
                  }),
                  React.createElement("span", { style: { fontWeight: 500 } }, "Пользователь")
                ),
                React.createElement(
                  "label",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      cursor: editSubmitting ? "default" : "pointer",
                      padding: "8px 10px",
                      borderRadius: "10px",
                      background: editRole === "owner" ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
                      border: "1px solid rgba(148, 163, 184, 0.25)",
                    },
                  },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: editRole === "owner",
                    onChange: function () { if (!editSubmitting) setEditRole("owner"); },
                    disabled: editSubmitting,
                    style: { flexShrink: 0 },
                  }),
                  React.createElement("span", { style: { fontWeight: 500 } }, "Владелец")
                )
              )
            ),
            editRole === "user" && editObjects.length > 0 && React.createElement(
              "div",
              { style: { marginTop: "16px" } },
              React.createElement("div", { className: "field-label", style: { marginBottom: "8px" } }, "Объекты для пользователя (выберите один или несколько)"),
              React.createElement(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    maxHeight: "220px",
                    overflowY: "auto",
                    padding: "10px 12px",
                    borderRadius: "12px",
                    border: "1px solid rgba(148, 163, 184, 0.4)",
                    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
                    color: "#e5e7eb",
                  },
                },
                editObjects.map(function (obj) {
                  var name = obj.object_name || "Объект #" + obj.id;
                  var address = obj.object_address ? String(obj.object_address).trim() : "";
                  return React.createElement(
                    "label",
                    {
                      key: obj.id,
                      style: {
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                        cursor: editSubmitting ? "default" : "pointer",
                        padding: "8px 10px",
                        borderRadius: "10px",
                        background: "rgba(15, 23, 42, 0.6)",
                        border: "1px solid rgba(148, 163, 184, 0.25)",
                      },
                    },
                    React.createElement("input", {
                      type: "checkbox",
                      checked: !!editSelectedObjectIds[obj.id],
                      onChange: function () { toggleEditObject(obj.id); },
                      disabled: editSubmitting,
                      style: { marginTop: "3px", flexShrink: 0 },
                    }),
                    React.createElement(
                      "div",
                      { style: { flex: 1, minWidth: 0 } },
                      React.createElement("div", { style: { fontSize: "13px", fontWeight: 500, color: "#e5e7eb" } }, name),
                      address ? React.createElement("div", { style: { fontSize: "12px", color: "#9ca3af", marginTop: "2px" } }, address) : null
                    )
                  );
                })
              )
            ),
            React.createElement(
              "div",
              { style: { display: "flex", gap: "12px", marginTop: "16px" } },
              React.createElement(
                "button",
                { className: "button", type: "submit", disabled: editSubmitting, style: { flex: 1 } },
                editSubmitting ? "Сохранение..." : "Сохранить параметры"
              ),
              React.createElement(
                "button",
                { 
                  className: "button button-secondary", 
                  type: "button", 
                  onClick: handleDeactivateUser, 
                  disabled: editSubmitting,
                  style: { 
                    flex: 1,
                    background: "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(220, 38, 38, 0.15))",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#fca5a5"
                  } 
                },
                editSubmitting ? "Деактивация..." : "Деактивировать пользователя"
              )
            )
          )
        )
      ),
      viewMode === "create" && error && React.createElement(
        "div",
        { className: "alert alert-error", style: { marginTop: "16px" } },
        React.createElement("div", { className: "alert-icon" }, "!"),
        React.createElement(
          "div",
          { className: "alert-body" },
          React.createElement("div", { className: "alert-title" }, "Ошибка"),
          React.createElement("div", { className: "alert-text" }, error)
        )
      ),
      viewMode === "create" && success && React.createElement(
        "div",
        { className: "alert alert-success", style: { marginTop: "16px" } },
        React.createElement("div", { className: "alert-icon" }, "✓"),
        React.createElement(
          "div",
          { className: "alert-body" },
          React.createElement("div", { className: "alert-title" }, "Готово"),
          React.createElement("div", { className: "alert-text" }, success)
        )
      ),
      viewMode === "edit" && editError && React.createElement(
        "div",
        { className: "alert alert-error", style: { marginTop: "16px" } },
        React.createElement("div", { className: "alert-icon" }, "!"),
        React.createElement(
          "div",
          { className: "alert-body" },
          React.createElement("div", { className: "alert-title" }, "Ошибка"),
          React.createElement("div", { className: "alert-text" }, editError)
        )
      ),
      viewMode === "edit" && editSuccess && React.createElement(
        "div",
        { className: "alert alert-success", style: { marginTop: "16px" } },
        React.createElement("div", { className: "alert-icon" }, "✓"),
        React.createElement(
          "div",
          { className: "alert-body" },
          React.createElement("div", { className: "alert-title" }, "Готово"),
          React.createElement("div", { className: "alert-text" }, editSuccess)
        )
      ),
      viewMode === "create" && createdCredentials && React.createElement(
        "div",
        {
          role: "button",
          tabIndex: 0,
          onClick: copyCredentialsToClipboard,
          onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); copyCredentialsToClipboard(); } },
          style: {
            marginTop: "20px",
            padding: "16px 18px",
            borderRadius: "12px",
            border: "2px solid rgba(56, 189, 248, 0.5)",
            background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
            maxWidth: "400px",
            cursor: "pointer",
            userSelect: "none",
            WebkitTapHighlightColor: "transparent",
          },
        },
        React.createElement("div", { style: { fontWeight: 600, marginBottom: "10px", fontSize: "1rem", color: "#e5e7eb" } }, "Данные для доступа: email и пароль"),
        React.createElement("div", { style: { fontSize: "12px", color: "#9ca3af", marginBottom: "10px" } }, copiedToClipboard ? "Скопировано!" : "Нажмите или коснитесь, чтобы скопировать"),
        React.createElement("div", { style: { marginBottom: "8px", color: "#e5e7eb" } },
          React.createElement("span", { style: { fontWeight: 500 } }, "Email: "),
          React.createElement("span", { style: { fontFamily: "monospace", wordBreak: "break-all" } }, createdCredentials.email)
        ),
        React.createElement("div", { style: { color: "#e5e7eb" } },
          React.createElement("span", { style: { fontWeight: 500 } }, "Пароль: "),
          React.createElement("span", { style: { fontFamily: "monospace", wordBreak: "break-all" } }, createdCredentials.password)
        )
      )
    );
  }

  // ---------- ОСНОВНОЙ SHELL С НАВИГАЦИЕЙ ----------

  function MainShell(props) {
    var currentScreenState = useState("menu");
    var currentScreen = currentScreenState[0];
    var setCurrentScreen = currentScreenState[1];

    var counterTypesState = useState([]);
    var counterTypes = counterTypesState[0];
    var setCounterTypes = counterTypesState[1];

    var ownersState = useState([]);
    var owners = ownersState[0];
    var setOwners = ownersState[1];

    // Load counter types and owners from database on mount
    useEffect(function () {
      if (!supabase) return;
      
      supabase
        .from("counter_types")
        .select("name")
        .eq("is_active", true)
        .order("sort_order")
        .then(function (res) {
          if (!res.error && res.data) {
            setCounterTypes(res.data.map(function (r) { return r.name; }));
          }
        })
        .catch(function (err) {
          console.error("Failed to load counter types:", err);
        });

      supabase
        .from("owners")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order")
        .then(function (res) {
          if (!res.error && res.data) {
            setOwners(res.data);
          }
        })
        .catch(function (err) {
          console.error("Failed to load owners:", err);
        });
    }, []);

    function handleNavigate(screen) {
      setCurrentScreen(screen);
    }

    var screenContent;
    if (currentScreen === "menu") {
      screenContent = React.createElement(MainMenu, {
        employee: props.employee,
        onLogout: props.onLogout,
        onNavigate: handleNavigate,
      });
    } else if (currentScreen === "readings") {
      screenContent = React.createElement(ReadingsScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        employee: props.employee,
      });
    } else if (currentScreen === "create-object") {
      screenContent = React.createElement(CreateObjectScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        counterTypes: counterTypes,
        owners: owners,
      });
    } else if (currentScreen === "edit-object") {
      screenContent = React.createElement(EditObjectScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        counterTypes: counterTypes,
        owners: owners,
      });
    } else if (currentScreen === "stats") {
      screenContent = React.createElement(StatsScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        employee: props.employee,
      });
    } else if (currentScreen === "archive") {
      screenContent = React.createElement(ArchiveScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
      });
    } else if (currentScreen === "users") {
      screenContent = React.createElement(UserManagementScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        session: props.session,
        employee: props.employee,
      });
    } else if (currentScreen === "telegram") {
      screenContent = React.createElement(TelegramScreen, {
        employee: props.employee,
        onNavigate: handleNavigate,
      });
    }

    return React.createElement("div", { className: "panel" }, screenContent);
  }

  function RightColumn(props) {
    var isLoggedIn = !!props.session && !!props.employee;
    var emp = props.employee || {};

    return React.createElement(
      "div",
      { className: "layout-right" },
      React.createElement(
        "div",
        { className: "panel" },
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              isLoggedIn ? "Статус системы" : "Вы не авторизованы"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              isLoggedIn
                ? "Блок 02 — Главное меню"
                : "Внутренняя система учёта энергоресурсов"
            )
          )
        ),
        isLoggedIn
          ? React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { className: "stack" },
                React.createElement(
                  "div",
                  { className: "stack-row" },
                  React.createElement(
                    "div",
                    { className: "stack-label" },
                    "Сотрудник"
                  ),
                  React.createElement(
                    "div",
                    { className: "stack-value" },
                    emp.first_name || "—",
                    " ",
                    emp.last_name || ""
                  )
                ),
                React.createElement(
                  "div",
                  { className: "stack-row" },
                  React.createElement(
                    "div",
                    { className: "stack-label" },
                    "Статус"
                  ),
                  React.createElement(
                    "div",
                    { className: "stack-value" },
                    "Доступ разрешён"
                  )
                )
              ),
              React.createElement("div", { className: "separation" }),
              React.createElement(
                "div",
                { className: "hint" },
                "Основной экран — «Внести показания». Поиск объекта, выбор даты и ввод показаний счётчиков."
              )
            )
          : React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { className: "stack" },
                React.createElement(
                  "div",
                  { className: "stack-row" },
                  React.createElement(
                    "div",
                    { className: "stack-label" },
                    "Статус"
                  ),
                  React.createElement(
                    "div",
                    { className: "stack-value" },
                    "Доступ только по логину и паролю"
                  )
                )
              ),
              React.createElement("div", { className: "separation" }),
              React.createElement(
                "div",
                { className: "hint" },
                "Введите свой корпоративный email и пароль, чтобы получить доступ к системе."
              )
            )
      )
    );
  }

  function TelegramScreen(props) {
    var linkTokenState = useState(null);
    var linkToken = linkTokenState[0];
    var setLinkToken = linkTokenState[1];

    var loadingState = useState(false);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    var tgLinkedState = useState(!!props.employee.tg_id);
    var tgLinked = tgLinkedState[0];
    var setTgLinked = tgLinkedState[1];

    var checkingStatusState = useState(false);
    var checkingStatus = checkingStatusState[0];
    var setCheckingStatus = checkingStatusState[1];

    var checkIntervalState = useState(null);
    var checkInterval = checkIntervalState[0];
    var setCheckInterval = checkIntervalState[1];

    useEffect(function () {
      setTgLinked(!!props.employee.tg_id);
      setCheckingStatus(true);
      supabase
        .from("employees")
        .select("tg_id")
        .eq("id", props.employee.id)
        .single()
        .then(function (result) {
          setCheckingStatus(false);
          if (result.data && result.data.tg_id) {
            props.employee.tg_id = result.data.tg_id;
            setTgLinked(true);
          } else {
            setTgLinked(false);
          }
        })
        .catch(function (err) {
          console.error("Error refreshing tg_id:", err);
          setCheckingStatus(false);
          setTgLinked(!!props.employee.tg_id);
        });
    }, []);

    useEffect(function () {
      return function () {
        if (checkInterval) {
          clearInterval(checkInterval);
        }
      };
    }, [checkInterval]);

    function startCheckingStatus() {
      if (checkInterval) {
        clearInterval(checkInterval);
      }

      setCheckingStatus(true);
      
      var intervalId = setInterval(function () {
        supabase
          .from("employees")
          .select("tg_id")
          .eq("id", props.employee.id)
          .single()
          .then(function (result) {
            if (result.error) {
              return;
            }

            if (result.data && result.data.tg_id) {
              clearInterval(intervalId);
              setCheckInterval(null);
              setCheckingStatus(false);
              alert("✅ Telegram успешно привязан! Страница обновится.");
              window.location.reload();
            }
          })
          .catch(function (err) {
            console.error("Error checking tg_id:", err);
          });
      }, 3000);

      setCheckInterval(intervalId);
    }

    function stopCheckingStatus() {
      if (checkInterval) {
        clearInterval(checkInterval);
        setCheckInterval(null);
      }
      setCheckingStatus(false);
    }

    function generateLinkToken() {
      setError(null);
      setSuccess(false);
      setLoading(true);

      var token = Math.random().toString(36).substring(2) + Date.now().toString(36);
      var expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      console.log("🔑 Generating token:", token);
      console.log("⏰ Expires at:", expiresAt.toISOString());
      console.log("👤 Employee ID:", props.employee.id);

      supabase
        .from("employees")
        .update({
          link_token: token,
          link_expires_at: expiresAt.toISOString(),
        })
        .eq("id", props.employee.id)
        .then(function (result) {
          console.log("📝 Update result:", result);
          
          if (result.error) {
            console.error("❌ Error updating employee:", result.error);
            setError("Не удалось создать токен привязки: " + result.error.message);
            setLoading(false);
            return;
          }

          console.log("✅ Token saved successfully:", token);
          setLinkToken(token);
          setLoading(false);
          startCheckingStatus();
        })
        .catch(function (err) {
          console.error("❌ Catch error:", err);
          setError("Ошибка при генерации токена");
          setLoading(false);
        });
    }

    function handleUnlink() {
      if (!confirm("Отвязать Telegram аккаунт?")) {
        return;
      }

      setError(null);
      setSuccess(false);
      setLoading(true);

      supabase
        .from("employees")
        .update({ tg_id: null, link_token: null, link_expires_at: null })
        .eq("id", props.employee.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось отвязать Telegram: " + result.error.message);
            setLoading(false);
            return;
          }

          setSuccess(true);
          setTgLinked(false);
          setLinkToken(null);
          setLoading(false);
          
          setTimeout(function() {
            window.location.reload();
          }, 1000);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при отвязке Telegram");
          setLoading(false);
        });
    }

    var deepLink = linkToken
      ? "https://t.me/money_cheking_bot?start=" + linkToken
      : "";

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { className: "top-bar" },
        React.createElement(
          "button",
          {
            className: "back-button",
            onClick: function () {
              props.onNavigate("menu");
            },
          },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Telegram"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            "Привязка аккаунта для уведомлений"
          )
        ),
        React.createElement(
          "span",
          { className: "badge" },
          tgLinked ? "Привязан ✓" : "Не привязан"
        )
      ),
      React.createElement("div", { className: "divider" }),
      !tgLinked
        ? React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "16px" } },
              "Привяжите свой Telegram аккаунт для получения уведомлений о системных событиях."
            ),
            !linkToken
              ? React.createElement(
                  "button",
                  {
                    className: "button",
                    onClick: generateLinkToken,
                    disabled: loading,
                  },
                  loading ? "Генерация..." : "📱 Привязать Telegram"
                )
              : React.createElement(
                  "div",
                  null,
                  React.createElement(
                    "div",
                    {
                      className: "alert alert-success",
                      style: { marginBottom: "16px" },
                    },
                    React.createElement("div", { className: "alert-icon" }, "✓"),
                    React.createElement(
                      "div",
                      { className: "alert-body" },
                      React.createElement(
                        "div",
                        { className: "alert-title" },
                        "Токен сгенерирован"
                      ),
                      React.createElement(
                        "div",
                        { className: "alert-text" },
                        "Токен действителен в течение 1 часа"
                      )
                    )
                  ),
                  React.createElement(
                    "div",
                    { className: "field-label" },
                    "Шаг 1: Перейдите в бота"
                  ),
                  React.createElement(
                    "a",
                    {
                      href: deepLink,
                      target: "_blank",
                      rel: "noopener noreferrer",
                      className: "button",
                      style: {
                        display: "inline-block",
                        textDecoration: "none",
                        marginBottom: "16px",
                      },
                    },
                    "Открыть @money_cheking_bot"
                  ),
                  React.createElement("div", { className: "divider" }),
                  React.createElement(
                    "div",
                    { className: "field-label" },
                    "Шаг 2: Отправьте команду в боте"
                  ),
                  React.createElement(
                    "div",
                    {
                      className: "hint",
                      style: { marginBottom: "8px" },
                    },
                    "Бот автоматически запустится с нужным токеном. Если нет — скопируйте команду ниже:"
                  ),
                  React.createElement(
                    "div",
                    {
                      style: {
                        background: "rgba(255,255,255,0.05)",
                        padding: "12px",
                        borderRadius: "6px",
                        fontFamily: "monospace",
                        fontSize: "13px",
                        wordBreak: "break-all",
                        marginBottom: "16px",
                      },
                    },
                    "/start " + linkToken
                  ),
                  React.createElement("div", { className: "divider" }),
                  checkingStatus
                    ? React.createElement(
                        "div",
                        null,
                        React.createElement(
                          "div",
                          {
                            className: "alert alert-success",
                            style: { marginTop: "12px" },
                          },
                          React.createElement("div", { className: "alert-icon" }, "⏳"),
                          React.createElement(
                            "div",
                            { className: "alert-body" },
                            React.createElement(
                              "div",
                              { className: "alert-title" },
                              "Ожидание привязки..."
                            ),
                            React.createElement(
                              "div",
                              { className: "alert-text" },
                              "Проверяем статус каждые 3 секунды. После успешной привязки в Telegram страница автоматически обновится."
                            )
                          )
                        ),
                        React.createElement(
                          "button",
                          {
                            className: "button button-secondary",
                            onClick: stopCheckingStatus,
                            style: { marginTop: "12px" },
                          },
                          "⏸ Остановить проверку"
                        )
                      )
                    : React.createElement(
                        "div",
                        { className: "hint" },
                        "После отправки команды в боте страница автоматически обновится через несколько секунд."
                      )
                )
          )
        : React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              {
                className: "alert alert-success",
                style: { marginBottom: "16px" },
              },
              React.createElement("div", { className: "alert-icon" }, "✓"),
              React.createElement(
                "div",
                { className: "alert-body" },
                React.createElement(
                  "div",
                  { className: "alert-title" },
                  "Telegram привязан"
                ),
                React.createElement(
                  "div",
                  { className: "alert-text" },
                  "Вы будете получать уведомления в Telegram"
                )
              )
            ),
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "16px" } },
              "Ваш Telegram ID: " + props.employee.tg_id
            ),
            React.createElement(
              "button",
              {
                className: "button",
                onClick: handleUnlink,
                disabled: loading,
                style: {
                  background: "linear-gradient(135deg, #dc2626, #991b1b)",
                  borderColor: "rgba(248, 113, 113, 0.9)",
                },
              },
              loading ? "Отвязка..." : "Отвязать Telegram"
            )
          ),
      error &&
        React.createElement(
          "div",
          { className: "alert alert-error", style: { marginTop: "16px" } },
          React.createElement("div", { className: "alert-icon" }, "!"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement("div", { className: "alert-title" }, "Ошибка"),
            React.createElement("div", { className: "alert-text" }, error)
          )
        ),
      success &&
        React.createElement(
          "div",
          { className: "alert alert-success", style: { marginTop: "16px" } },
          React.createElement("div", { className: "alert-icon" }, "✓"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Успешно"
            ),
            React.createElement(
              "div",
              { className: "alert-text" },
              "Telegram успешно отвязан"
            )
          )
        )
    );
  }

  function App() {
    var auth = useAuth();
    var session = auth.session;
    var employee = auth.employee;
    var loading = auth.loading;
    var error = auth.error;
    var login = auth.login;
    var logout = auth.logout;
    var supabaseReady = auth.supabaseReady;

    return React.createElement(
      "div",
      { className: "app-shell" },
      React.createElement(
        "header",
        { className: "app-header" },
        React.createElement(
          "div",
          { className: "app-title" },
          React.createElement("div", { className: "app-logo" }),
          React.createElement(
            "div",
            { className: "app-title-main" },
            "Энергомониторинг"
          )
        )
      ),
      React.createElement(
        "main",
        { className: "app-main" },
        !session || !employee
          ? React.createElement(LoginForm, {
              onLogin: login,
              error: error,
              loading: loading,
              supabaseReady: supabaseReady,
            })
          : React.createElement(MainShell, {
              employee: employee,
              session: session,
              onLogout: logout,
            })
      )
    );
  }

  var container = document.getElementById("root");
  ReactDOM.createRoot(container).render(React.createElement(App));
  if (container && container.dataset) {
    container.dataset.app = "ready";
  }
})();
